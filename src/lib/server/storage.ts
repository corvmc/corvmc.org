import { env } from '$env/dynamic/private';
import { DEFAULT_WIDTH, transformOptions } from '$lib/utils/images';

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const MAX_SIZE_LABEL = `${Math.round(MAX_SIZE_BYTES / 1024 / 1024)}MB`;

/**
 * Validate an upload's type and size. Returns a human-readable reason when the
 * file is invalid, or `null` when it's acceptable. Callers should surface the
 * reason as a 4xx so it isn't treated as a server bug (see hooks.server.ts).
 */
export function validateUpload(file: File): string | null {
	if (!ALLOWED_TYPES.includes(file.type)) {
		return `File type "${file.type}" is not allowed. Accepted: ${ALLOWED_TYPES.join(', ')}`;
	}
	if (file.size > MAX_SIZE_BYTES) {
		return `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_SIZE_LABEL} limit`;
	}
	return null;
}

let _bucket: R2Bucket;

export function initStorage(bucket: R2Bucket) {
	_bucket = bucket;
}

function getBucket(): R2Bucket {
	if (!_bucket)
		throw new Error('Storage not initialized — call initStorage() in hooks.server.ts first');
	return _bucket;
}

export async function uploadFile(
	buffer: ArrayBuffer,
	key: string,
	contentType: string,
	allowedTypes: string[] = ALLOWED_TYPES
): Promise<string> {
	if (!allowedTypes.includes(contentType)) {
		throw new Error(
			`File type "${contentType}" is not allowed. Accepted: ${allowedTypes.join(', ')}`
		);
	}

	if (buffer.byteLength > MAX_SIZE_BYTES) {
		throw new Error(
			`File size ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_SIZE_LABEL} limit`
		);
	}

	await getBucket().put(key, buffer, {
		httpMetadata: { contentType }
	});

	return key;
}

export async function deleteObject(key: string): Promise<void> {
	await getBucket().delete(key);
}

/**
 * Copy an existing object to a new key, preserving its content type. Returns the
 * destination key, or null when the source object does not exist. Used to give
 * generated recurring-event occurrences their own independent copy of the
 * prototype's poster (so re-postering or cancelling one never affects others).
 */
export async function copyObject(srcKey: string, destKey: string): Promise<string | null> {
	const bucket = getBucket();
	const src = await bucket.get(srcKey);
	if (!src) return null;
	await bucket.put(destKey, src.body, { httpMetadata: src.httpMetadata });
	return destKey;
}

/**
 * Formats Cloudflare Image Transformations can actually decode. Non-image
 * uploads — rider and stage-plot PDFs from the band media endpoint — must fall
 * through to the plain R2 URL, since wrapping them yields a broken link.
 *
 * Gating on the key's extension rather than on a caller-supplied flag keeps this
 * a property of the single chokepoint every one of the ~48 `resolveImageUrl`
 * callers already funnels through, so a new call site can't forget it. The
 * extension is trustworthy: every key builder derives it from the validated
 * content type (see `extensionForType`), never from a user-supplied filename.
 */
const TRANSFORMABLE = /\.(jpe?g|png|webp|gif|avif)$/i;

export function getPublicUrl(key: string): string {
	if (/^https?:\/\//i.test(key)) return key; // already resolved — don't double-prefix

	const transformUrl = env.R2_TRANSFORM_URL;
	if (transformUrl && TRANSFORMABLE.test(key)) {
		// `R2_TRANSFORM_SOURCE_ABSOLUTE` switches the source from a bare key to a
		// full URL, for the case where transformations are served from the apex
		// zone rather than from the bucket's own custom domain.
		const source = env.R2_TRANSFORM_SOURCE_ABSOLUTE ? `${env.R2_PUBLIC_URL}/${key}` : key;
		return `${transformUrl}/${transformOptions(DEFAULT_WIDTH)}/${source}`;
	}

	const publicUrl = env.R2_PUBLIC_URL;
	if (!publicUrl) throw new Error('R2_PUBLIC_URL is not set');
	return `${publicUrl}/${key}`;
}

/**
 * Resolve an R2 key to a public URL, returning null if not available.
 * Convenience wrapper for optional image keys stored on models.
 */
export function resolveImageUrl(key: string | null | undefined): string | null {
	if (!key) return null;
	if (!_bucket) return null;
	try {
		return getPublicUrl(key);
	} catch {
		return null;
	}
}

export function isConfigured(): boolean {
	return !!_bucket;
}
