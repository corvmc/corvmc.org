/**
 * The private R2 bucket.
 *
 * Deliberately a separate module from `storage.ts` rather than a second binding
 * inside it. That module's central function is `getPublicUrl()`, which mints a
 * `media.corvmc.org` transform URL for any key it is handed — and it cannot tell
 * which bucket a key came from. Sharing a module would put a function that
 * publishes things one autocomplete away from every private object we hold,
 * which is the exact hazard `contractor_job.invoiceRef` refuses to take:
 *
 * > A string, not a file: the one R2 bucket is served publicly at
 * > media.corvmc.org, and an invoice with hourly rates on it has no business
 * > being addressable by key.
 *
 * So the separation is the safety property, not tidiness. **Nothing in here
 * returns a URL, and nothing should.** A private object reaches a person through
 * a request that authorizes them first and streams the body — never through an
 * address they could pass on.
 *
 * What makes the bucket private is that it has no custom domain and no r2.dev
 * URL, which is R2's default and is asserted in `wrangler.toml` beside the
 * binding. The public bucket is public *because* of `media.corvmc.org`; there is
 * no per-bucket "private" switch to get wrong.
 *
 * The surface is deliberately thin. Three consumers were designed and unbuilt —
 * group documents (`docs/specs/groups-spec.md`), contractor invoices, and
 * digital downloads — and each will want different key conventions, validation
 * and retention. Guessing at those now would mean three callers bending around
 * one wrong abstraction, so this exposes the bucket and lets the first real
 * consumer establish the pattern.
 *
 * **Group documents is that first consumer**, and it established this split: the
 * I/O below is generic, because an invoice and a chart are both "bytes at a key
 * in this bucket", while the policy below it — which content types, how large —
 * is document-specific and named so. The one rule the I/O does enforce for
 * everybody is `MAX_DOCUMENT_BYTES`, which is a property of the 128 MB isolate
 * the body passes through rather than of documents.
 */

let _bucket: R2Bucket;

export function initPrivateStorage(bucket: R2Bucket) {
	_bucket = bucket;
}

/**
 * The private bucket, or a throw.
 *
 * Mirrors `getBucket()` in `storage.ts`, including the message shape: a missing
 * binding is a deployment problem, and saying which init call is absent is what
 * makes it a two-minute fix instead of a hunt.
 */
export function getPrivateBucket(): R2Bucket {
	if (!_bucket)
		throw new Error(
			'Private storage not initialized — call initPrivateStorage() in hooks.server.ts first'
		);
	return _bucket;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Write an object, or throw.
 *
 * Returns the key it was given, mirroring `uploadFile` in `storage.ts` — a
 * caller that wants to record what it wrote should not have to remember what it
 * passed. It is emphatically **not** a URL, and there is nothing here that could
 * turn it into one.
 *
 * The size ceiling is enforced here rather than only at the caller because it is
 * a fact about the runtime: the body arrives through `request.formData()` as an
 * `ArrayBuffer` inside a 128 MB isolate, so every future consumer of this bucket
 * inherits the same limit whether or not it remembers to check.
 */
export async function putPrivateObject(
	key: string,
	body: ArrayBuffer,
	contentType: string
): Promise<string> {
	if (body.byteLength > MAX_DOCUMENT_BYTES) {
		throw new Error(
			`File size ${(body.byteLength / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_DOCUMENT_LABEL} limit`
		);
	}

	await getPrivateBucket().put(key, body, { httpMetadata: { contentType } });

	return key;
}

/**
 * Read an object, or null if it is not there.
 *
 * Returns R2's own object so the caller can stream `.body` straight into a
 * `Response`. Buffering it here — the obvious-looking `ArrayBuffer` return —
 * would put a 25 MB file in the isolate and burn CPU proportional to size, which
 * is the one thing the download route must not do.
 */
export async function getPrivateObject(key: string): Promise<R2ObjectBody | null> {
	return await getPrivateBucket().get(key);
}

/**
 * Delete an object. Deleting a key R2 does not have is a no-op success, which is
 * what makes the sweep safe to re-run over a row whose object it already reaped.
 */
export async function deletePrivateObject(key: string): Promise<void> {
	await getPrivateBucket().delete(key);
}

// ---------------------------------------------------------------------------
// Document policy
// ---------------------------------------------------------------------------

/**
 * What a group document may be. Deliberately **not** an edit to
 * `ALLOWED_TYPES` in `storage.ts`, which also governs avatars.
 *
 * Legacy macro-bearing Office formats (`application/msword`,
 * `application/vnd.ms-excel`), `application/zip` and
 * `application/octet-stream` are excluded by decision: `File.type` is
 * browser-supplied and spoofable and there is no virus scanning, so the list is
 * the only thing standing between the bucket and an arbitrary binary. The
 * exposure that remains is bounded — authenticated members only, forced
 * attachment, `nosniff` — and is stated in the spec rather than left implicit.
 */
export const PRIVATE_ALLOWED_TYPES = [
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/webp',
	'text/plain',
	'text/csv',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
] as const;

/**
 * 25 MB, and a hard ceiling rather than a tunable one.
 *
 * `uploadFile()` in `storage.ts` caps at 10 MB whatever `allowedTypes` it is
 * handed, which is small for a real document — so this module carries its own
 * number instead of raising the shared one and quietly loosening avatars.
 * Anything larger needs presigned multipart upload, which is out of scope.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_LABEL = '25MB';

/**
 * Reject a file before anything is written, or return null. The reason is
 * shown to the uploader, so it names the type and the limit.
 *
 * Mirrors `validateUpload` in `storage.ts`, including the return shape: a
 * reason string or null, so a caller cannot forget to check by mistaking a
 * thrown error for a passing one.
 */
export function validatePrivateUpload(file: File): string | null {
	if (!(PRIVATE_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
		return `File type "${file.type}" is not allowed. Accepted: PDF, images, text, CSV, Word and Excel documents`;
	}
	if (file.size > MAX_DOCUMENT_BYTES) {
		return `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_DOCUMENT_LABEL} limit`;
	}
	return null;
}
