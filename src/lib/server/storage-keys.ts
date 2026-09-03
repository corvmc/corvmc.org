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
		'application/pdf': 'pdf',
		// The document half, for the private bucket. None of these are in
		// `TRANSFORMABLE`, so nothing about the public image path changes.
		'text/plain': 'txt',
		'text/csv': 'csv',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
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

/**
 * The key for a group document in the **private** bucket.
 *
 * The row id goes in the key and the filename goes nowhere near it: two uploads
 * named `minutes.pdf` must not collide, and the key must not be guessable from
 * what the list displays. Unlike `mediaKey` there is no random token, because
 * the id already is one and nothing here is served from a cacheable URL.
 */
export function documentKey(groupId: string, fileId: string, contentType: string): string {
	return `groups/${groupId}/documents/${fileId}.${extensionForType(contentType)}`;
}

/** What a filename falls back to once everything unusable is stripped out. */
const FALLBACK_FILENAME = 'download';

/**
 * Flatten an uploaded filename into something safe to store, display, and put in
 * a header.
 *
 * Strips control characters (CR and LF above all — a newline here is header
 * injection on the download response), quotes and backslashes (which would
 * escape the quoted `filename=` parameter), and path separators (so
 * `../../etc/passwd` cannot become a path). Never returns an empty string,
 * because a `filename=""` is worse than a made-up name.
 */
export function sanitizeFilename(name: string): string {
	const flattened = name
		// eslint-disable-next-line no-control-regex -- the point is to remove them
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/["\\]/g, '')
		.replace(/[/]/g, '-')
		.trim();
	return (flattened || FALLBACK_FILENAME).slice(0, 255);
}

/**
 * A `Content-Disposition` that forces a download.
 *
 * Sanitizes again rather than trusting the column. `filename` is written
 * sanitized, but a header built from stored state is a header built from
 * something a migration, a backfill or a hand-edited row could have poisoned,
 * and the cost of running it twice is nothing.
 */
export function contentDispositionAttachment(filename: string): string {
	return `attachment; filename="${sanitizeFilename(filename)}"`;
}
