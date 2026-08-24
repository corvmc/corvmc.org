/**
 * How uploaded files are *named* in R2. Kept separate from `storage.ts` because
 * these are pure functions with no bucket and no environment: services can call
 * them for real in tests that mock the storage I/O module.
 */

/**
 * File extension for a validated content type. `bin` for anything unrecognised,
 * which is deliberately not in `TRANSFORMABLE` — an unknown type must never be
 * handed to an image transformation. In practice every caller has already run
 * `validateUpload`, so the fallback is defensive only.
 */
export function extensionForType(contentType: string): string {
	const map: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif',
		'application/pdf': 'pdf'
	};
	return map[contentType] ?? 'bin';
}

/**
 * Build a storage key that changes every time the same entity is re-uploaded.
 *
 * Keys used to be fully deterministic (`users/avatars/{userId}.jpg`), so
 * replacing an image reused its URL — invisible when R2 served originals, but a
 * guaranteed stale hit once responses are cached at the edge. The random token
 * gives each upload its own URL.
 *
 * Safe because every deletion path reads the stored key from the database and
 * deletes that, rather than reconstructing a key from the entity id.
 */
export function mediaKey(prefix: string, id: string, contentType: string): string {
	const token = crypto.randomUUID().slice(0, 8);
	return `${prefix}/${id}-${token}.${extensionForType(contentType)}`;
}
