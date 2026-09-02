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
 * The surface is deliberately thin. Three consumers are designed and unbuilt —
 * group documents (`docs/specs/groups-spec.md`), contractor invoices, and
 * digital downloads — and each will want different key conventions, validation
 * and retention. Guessing at those now would mean three callers bending around
 * one wrong abstraction, so this exposes the bucket and lets the first real
 * consumer establish the pattern.
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
