/**
 * The private bucket's first real consumer, and therefore the module that sets
 * its key convention.
 *
 * `private-storage.ts` deliberately exposes nothing but the bucket, on the
 * grounds that three designed consumers — group documents, contractor invoices,
 * digital downloads — would each want different validation and retention, and
 * guessing at all three would mean three callers bending around one wrong
 * abstraction. This is the digital-downloads one.
 *
 * **Nothing here returns a URL, and nothing should.** A recording reaches a
 * listener through a request that authorizes them and streams the body; there
 * is no address to hand out. That is also why this is not `storage.ts` with a
 * wider allowlist: that module's centre is `getPublicUrl()`, which will mint a
 * media.corvmc.org address for any key it is given and cannot tell which bucket
 * the key came from.
 */
import { getPrivateBucket } from '$lib/server/private-storage';
import { AUDIO_MAX_UPLOAD_BYTES } from '$lib/config';

/**
 * What a band may upload.
 *
 * Broader than the public bucket's three image types because there is no
 * transformation pipeline downstream to break — the bytes are streamed back
 * verbatim. `audio/x-wav` and `audio/vnd.wave` are here because browsers
 * disagree about which one a `.wav` is, and rejecting an upload over a MIME
 * spelling is an infuriating way to lose a record.
 */
export const AUDIO_TYPES = [
	'audio/mpeg',
	'audio/mp4',
	'audio/aac',
	'audio/flac',
	'audio/x-flac',
	'audio/wav',
	'audio/x-wav',
	'audio/vnd.wave',
	'audio/ogg',
	'audio/opus'
] as const;

const MAX_SIZE_LABEL = `${Math.round(AUDIO_MAX_UPLOAD_BYTES / 1024 / 1024)}MB`;

/** File extension for a validated audio type, mirroring `extensionForType`. */
export function audioExtensionForType(contentType: string): string {
	const map: Record<string, string> = {
		'audio/mpeg': 'mp3',
		'audio/mp4': 'm4a',
		'audio/aac': 'aac',
		'audio/flac': 'flac',
		'audio/x-flac': 'flac',
		'audio/wav': 'wav',
		'audio/x-wav': 'wav',
		'audio/vnd.wave': 'wav',
		'audio/ogg': 'ogg',
		'audio/opus': 'opus'
	};
	return map[contentType] ?? 'bin';
}

/**
 * A human-readable reason the upload is unacceptable, or `null`.
 *
 * Same contract as `validateUpload` in `storage.ts` — callers surface the reason
 * as a 4xx so `hooks.server.ts` does not treat it as a server fault.
 */
export function validateAudioUpload(file: {
	type: string;
	size: number;
	name?: string;
}): string | null {
	if (!AUDIO_TYPES.includes(file.type as (typeof AUDIO_TYPES)[number])) {
		return `"${file.name ?? 'file'}" is ${file.type || 'an unknown type'}. Upload MP3, M4A, FLAC, WAV, OGG or Opus.`;
	}
	if (file.size > AUDIO_MAX_UPLOAD_BYTES) {
		return `"${file.name ?? 'file'}" is ${(file.size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_SIZE_LABEL} limit. FLAC or a 320kbps MP3 will fit.`;
	}
	if (file.size === 0) return `"${file.name ?? 'file'}" is empty.`;
	return null;
}

/**
 * Where a track's object lives.
 *
 * The random token is the same device `mediaKey()` uses and for the same
 * reason: re-uploading a track mints a new key rather than reusing one, so no
 * cached response can outlive the bytes it described. Safe because every
 * deletion path reads the stored key rather than rebuilding one from an id.
 */
export function audioKey(trackId: string, contentType: string): string {
	const token = crypto.randomUUID().slice(0, 8);
	return `bands/audio/${trackId}-${token}.${audioExtensionForType(contentType)}`;
}

export async function putAudioObject(
	key: string,
	body: ArrayBuffer,
	contentType: string
): Promise<void> {
	await getPrivateBucket().put(key, body, { httpMetadata: { contentType } });
}

export async function deleteAudioObject(key: string): Promise<void> {
	await getPrivateBucket().delete(key);
}

/** Every key under the audio prefix, for the sweep to reconcile against live rows. */
export async function listAudioKeys(): Promise<{ key: string; uploaded: Date }[]> {
	const bucket = getPrivateBucket();
	const found: { key: string; uploaded: Date }[] = [];
	let cursor: string | undefined;

	do {
		const page = await bucket.list({ prefix: 'bands/audio/', cursor, limit: 1000 });
		for (const object of page.objects) found.push({ key: object.key, uploaded: object.uploaded });
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);

	return found;
}

// ---------------------------------------------------------------------------
// Range requests
// ---------------------------------------------------------------------------

export type ByteRange = { offset: number; length: number };

/**
 * Parse one `Range` header against a known object size.
 *
 * `null` means "serve the whole thing" — no header, a unit we do not speak, or
 * a malformed value, all of which HTTP says to ignore rather than reject.
 * `'unsatisfiable'` is the one case that earns a 416: a well-formed range that
 * starts past the end of the object.
 *
 * Multi-range requests (`bytes=0-99,200-299`) collapse to the whole object.
 * They are legal, no browser media element sends them, and answering one
 * properly means generating a multipart/byteranges body — cost with no caller.
 *
 * Written as a pure function over a size rather than against the bucket so the
 * edge cases have a spec that needs no R2. The suffix form in particular
 * (`bytes=-500`, meaning the *last* 500 bytes) is the one everybody gets wrong.
 */
export function parseRangeHeader(
	header: string | null,
	size: number
): ByteRange | null | 'unsatisfiable' {
	if (!header) return null;

	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;

	const [, rawStart, rawEnd] = match;

	// `bytes=-N` — the trailing N bytes. Not a negative offset.
	if (rawStart === '') {
		if (rawEnd === '') return null;
		const wanted = Number(rawEnd);
		if (wanted === 0) return 'unsatisfiable';
		const length = Math.min(wanted, size);
		return { offset: size - length, length };
	}

	const start = Number(rawStart);
	if (start >= size) return 'unsatisfiable';

	// `bytes=N-` — from N to the end.
	if (rawEnd === '') return { offset: start, length: size - start };

	const end = Number(rawEnd);
	if (end < start) return null;
	// The header is inclusive at both ends; R2 wants a length.
	return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

/**
 * Stream an object, honouring `Range`.
 *
 * Returns the response body plus the status and headers a caller must send.
 * The caller owns caching and authorization; this owns the byte arithmetic.
 */
export async function streamAudioObject(
	key: string,
	rangeHeader: string | null
): Promise<Response | null> {
	const bucket = getPrivateBucket();

	// A HEAD first, because the range has to be resolved against a real size
	// before R2 is asked for bytes — `bytes=-500` cannot be expressed as an
	// offset without one.
	const head = await bucket.head(key);
	if (!head) return null;

	const size = head.size;
	const range = parseRangeHeader(rangeHeader, size);

	if (range === 'unsatisfiable') {
		return new Response(null, {
			status: 416,
			headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' }
		});
	}

	const object = await bucket.get(key, range ? { range } : undefined);
	if (!object) return null;

	const headers = new Headers({
		'accept-ranges': 'bytes',
		'content-type': head.httpMetadata?.contentType ?? 'application/octet-stream',
		etag: head.httpEtag
	});

	if (range) {
		headers.set('content-length', String(range.length));
		headers.set(
			'content-range',
			`bytes ${range.offset}-${range.offset + range.length - 1}/${size}`
		);
	} else {
		headers.set('content-length', String(size));
	}

	return new Response(object.body as ReadableStream, {
		status: range ? 206 : 200,
		headers
	});
}
