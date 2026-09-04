import { describe, it, expect, vi } from 'vitest';

// The bucket accessor is the only thing in this module that touches the
// platform. Mocking it here — rather than importing the real one — is what lets
// the pure halves (range arithmetic, validation, key naming) have a spec that
// needs no R2 and no wrangler.
vi.mock('$lib/server/private-storage', () => ({
	getPrivateBucket: () => {
		throw new Error('not used in this spec');
	}
}));

import {
	parseRangeHeader,
	validateAudioUpload,
	audioKey,
	audioExtensionForType
} from './audio-storage';
import { AUDIO_MAX_UPLOAD_BYTES } from '$lib/config';

/**
 * The range arithmetic is where a media endpoint actually goes wrong, and it
 * goes wrong quietly: an off-by-one gives every listener a track that stalls a
 * byte early, and a mishandled suffix range makes Safari refuse to play at all
 * while every other browser is fine.
 */
describe('parseRangeHeader', () => {
	const SIZE = 1000;

	it('returns null when there is no header, so the caller serves the whole object', () => {
		expect(parseRangeHeader(null, SIZE)).toBeNull();
	});

	it('reads a closed range inclusively at both ends', () => {
		// `bytes=0-1` is the two-byte probe Safari opens every media request with,
		// and it must come back as 206 or Safari will not play the file at all.
		expect(parseRangeHeader('bytes=0-1', SIZE)).toEqual({ offset: 0, length: 2 });
		expect(parseRangeHeader('bytes=0-999', SIZE)).toEqual({ offset: 0, length: 1000 });
		expect(parseRangeHeader('bytes=100-199', SIZE)).toEqual({ offset: 100, length: 100 });
	});

	it('reads an open-ended range as "to the end"', () => {
		expect(parseRangeHeader('bytes=500-', SIZE)).toEqual({ offset: 500, length: 500 });
		expect(parseRangeHeader('bytes=0-', SIZE)).toEqual({ offset: 0, length: 1000 });
	});

	// The form everyone gets wrong: `bytes=-500` is the LAST 500 bytes, not a
	// negative offset and not "from 500".
	it('reads a suffix range as the trailing N bytes', () => {
		expect(parseRangeHeader('bytes=-500', SIZE)).toEqual({ offset: 500, length: 500 });
		expect(parseRangeHeader('bytes=-1', SIZE)).toEqual({ offset: 999, length: 1 });
	});

	it('clamps a suffix longer than the object to the whole object', () => {
		expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({ offset: 0, length: 1000 });
	});

	it('clamps an end past the last byte rather than over-reading', () => {
		// A player that asks for more than exists must get what exists, not a 416.
		expect(parseRangeHeader('bytes=900-5000', SIZE)).toEqual({ offset: 900, length: 100 });
	});

	it('calls a start past the end unsatisfiable, which is the one case that earns a 416', () => {
		expect(parseRangeHeader('bytes=1000-', SIZE)).toBe('unsatisfiable');
		expect(parseRangeHeader('bytes=5000-5100', SIZE)).toBe('unsatisfiable');
		// Zero trailing bytes cannot be served as a range either.
		expect(parseRangeHeader('bytes=-0', SIZE)).toBe('unsatisfiable');
	});

	it('ignores anything malformed or unsupported instead of rejecting it', () => {
		// HTTP says an unparseable Range is ignored, not an error — answering 416
		// here would break a client over a header it could have done without.
		expect(parseRangeHeader('bytes=abc-def', SIZE)).toBeNull();
		expect(parseRangeHeader('items=0-10', SIZE)).toBeNull();
		expect(parseRangeHeader('bytes=-', SIZE)).toBeNull();
		expect(parseRangeHeader('', SIZE)).toBeNull();
		// A reversed range is nonsense rather than unsatisfiable.
		expect(parseRangeHeader('bytes=500-100', SIZE)).toBeNull();
		// Multi-range is legal and deliberately unsupported: no media element
		// sends one, and answering properly means a multipart/byteranges body.
		expect(parseRangeHeader('bytes=0-99,200-299', SIZE)).toBeNull();
	});

	it('tolerates surrounding whitespace', () => {
		expect(parseRangeHeader('  bytes=0-1  ', SIZE)).toEqual({ offset: 0, length: 2 });
	});

	it('never returns a range that reaches past the object', () => {
		// The property that matters, over the whole space of headers: whatever
		// comes back, offset+length is inside the object. An R2 `get` with a range
		// past the end returns null, which the endpoint would report as a 404 on a
		// track that exists.
		const headers = [
			'bytes=0-1',
			'bytes=0-',
			'bytes=999-',
			'bytes=-1',
			'bytes=-1000',
			'bytes=-99999',
			'bytes=998-99999',
			'bytes=0-99999'
		];
		for (const header of headers) {
			const range = parseRangeHeader(header, SIZE);
			if (range === null || range === 'unsatisfiable') continue;
			expect(range.offset).toBeGreaterThanOrEqual(0);
			expect(range.length).toBeGreaterThan(0);
			expect(range.offset + range.length).toBeLessThanOrEqual(SIZE);
		}
	});
});

describe('validateAudioUpload', () => {
	it('accepts the formats a band actually has', () => {
		for (const type of ['audio/mpeg', 'audio/flac', 'audio/wav', 'audio/mp4', 'audio/ogg']) {
			expect(validateAudioUpload({ type, size: 5_000_000, name: 'track.bin' })).toBeNull();
		}
	});

	// Browsers disagree about which MIME a .wav is, and losing a record over the
	// spelling would be an infuriating way to fail.
	it('accepts every spelling of WAV', () => {
		for (const type of ['audio/wav', 'audio/x-wav', 'audio/vnd.wave']) {
			expect(validateAudioUpload({ type, size: 1000, name: 'a.wav' })).toBeNull();
		}
	});

	it('rejects a non-audio file by naming it', () => {
		const reason = validateAudioUpload({ type: 'image/jpeg', size: 1000, name: 'cover.jpg' });
		expect(reason).toContain('cover.jpg');
	});

	it('rejects an empty file, which is what a failed export produces', () => {
		expect(
			validateAudioUpload({ type: 'audio/mpeg', size: 0, name: 'silence.mp3' })
		).not.toBeNull();
	});

	it('rejects a file over the cap and says what would fit', () => {
		const reason = validateAudioUpload({
			type: 'audio/wav',
			size: AUDIO_MAX_UPLOAD_BYTES + 1,
			name: 'master.wav'
		});
		expect(reason).toContain('master.wav');
		// The message has to be actionable, not just a refusal.
		expect(reason).toMatch(/FLAC|MP3/);
	});

	it('accepts a file exactly at the cap', () => {
		expect(
			validateAudioUpload({ type: 'audio/wav', size: AUDIO_MAX_UPLOAD_BYTES, name: 'a.wav' })
		).toBeNull();
	});
});

describe('audioKey', () => {
	it('puts every track under the swept prefix', () => {
		// The sweep reconciles `bands/audio/` against live rows. A key outside it
		// would leak on every failed upload, silently and forever.
		expect(audioKey('track-1', 'audio/mpeg').startsWith('bands/audio/')).toBe(true);
	});

	it('never reuses a key for the same track', () => {
		// Re-uploading mints a new URL, so no cached response outlives its bytes.
		const a = audioKey('track-1', 'audio/mpeg');
		const b = audioKey('track-1', 'audio/mpeg');
		expect(a).not.toBe(b);
	});

	it('carries the extension for the type', () => {
		expect(audioKey('t', 'audio/flac').endsWith('.flac')).toBe(true);
		expect(audioExtensionForType('audio/x-wav')).toBe('wav');
		// Unknown types land on `bin` rather than guessing.
		expect(audioExtensionForType('audio/weird')).toBe('bin');
	});
});
