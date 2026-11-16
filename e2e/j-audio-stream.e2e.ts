import { expect, test } from './fixtures/test';
import { SEED_AUDIO_TRACK_ID } from './fixtures/seed-band-audio';

/**
 * Range handling is the difference between a track that plays and one Safari
 * silently refuses. `audio-storage.spec.ts` pins the arithmetic; only a real
 * request through workerd and R2 proves the endpoint wires it up.
 */
const stream = (trackId: string) => `/api/audio/track/${trackId}/stream`;

test('the stream endpoint answers every range form', async ({ request }) => {
	const whole = await request.get(stream(SEED_AUDIO_TRACK_ID));
	expect(whole.status()).toBe(200);
	// Without this header a browser will not attempt to seek at all.
	expect.soft(whole.headers()['accept-ranges']).toBe('bytes');
	expect.soft(whole.headers()['content-type']).toContain('audio/wav');
	const size = Number(whole.headers()['content-length']);
	expect(size).toBeGreaterThan(0);

	const ranges = [
		// The two-byte request Safari opens every media element with. A 200 here means
		// the file never plays in Safari, and plays fine everywhere else.
		{ range: 'bytes=0-1', contentRange: /^bytes 0-1\/\d+$/, bytes: 2, contentLength: '2' },
		// Inclusive at both ends: 1000..1099 is 100 bytes, not 99 and not 101.
		{ range: 'bytes=1000-1099', contentRange: /^bytes 1000-1099\/\d+$/, bytes: 100 },
		// The LAST 500 bytes, not "from 500".
		{ range: 'bytes=-500', contentRange: `bytes ${size - 500}-${size - 1}/${size}`, bytes: 500 }
	];
	for (const { range, contentRange, bytes, contentLength } of ranges) {
		const response = await request.get(stream(SEED_AUDIO_TRACK_ID), {
			headers: { Range: range }
		});
		expect.soft(response.status(), range).toBe(206);
		expect.soft(response.headers()['content-range'], range).toMatch(contentRange);
		expect.soft((await response.body()).byteLength, range).toBe(bytes);
		if (contentLength) {
			expect.soft(response.headers()['content-length'], range).toBe(contentLength);
		}
	}

	const pastTheEnd = await request.get(stream(SEED_AUDIO_TRACK_ID), {
		headers: { Range: 'bytes=99999999-' }
	});
	expect.soft(pastTheEnd.status()).toBe(416);

	const unknown = await request.get(stream('not-a-real-track'));
	expect.soft(unknown.status()).toBe(404);
});
