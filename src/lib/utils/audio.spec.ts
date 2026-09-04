import { describe, it, expect } from 'vitest';
import { formatTrackLength, formatRuntime, formatTrackSummary } from './audio';

describe('formatTrackLength', () => {
	it('reads as a clock, zero-padded on the seconds only', () => {
		expect(formatTrackLength(222_000)).toBe('3:42');
		expect(formatTrackLength(65_000)).toBe('1:05');
		expect(formatTrackLength(9_000)).toBe('0:09');
	});

	it('adds an hours field only when there are hours', () => {
		// A 62-minute live set is "1:02:00", not "62:00" — but a 5-minute song must
		// not become "0:05:00".
		expect(formatTrackLength(3_720_000)).toBe('1:02:00');
		expect(formatTrackLength(300_000)).toBe('5:00');
	});

	it('rounds to the nearest second rather than truncating', () => {
		// 59.6s truncated is 0:59, which reads as a second short of the 1:00 the
		// player will sit on for half a second.
		expect(formatTrackLength(59_600)).toBe('1:00');
		expect(formatTrackLength(59_400)).toBe('0:59');
	});

	it('survives the values a broken file produces', () => {
		// `<audio>.duration` is NaN until metadata loads and Infinity on a stream.
		expect(formatTrackLength(0)).toBe('0:00');
		expect(formatTrackLength(NaN)).toBe('0:00');
		expect(formatTrackLength(Infinity)).toBe('0:00');
		expect(formatTrackLength(-5)).toBe('0:00');
	});
});

describe('formatRuntime', () => {
	it('rounds a record to whole minutes', () => {
		expect(formatRuntime(38 * 60_000)).toBe('38 min');
		expect(formatRuntime(90_000)).toBe('2 min');
	});

	it('breaks into hours past sixty minutes', () => {
		expect(formatRuntime(64 * 60_000)).toBe('1 hr 4 min');
		expect(formatRuntime(120 * 60_000)).toBe('2 hr');
	});

	it('does not claim zero minutes for a short single', () => {
		expect(formatRuntime(20_000)).toBe('under a minute');
	});
});

describe('formatTrackSummary', () => {
	it('pluralizes the count', () => {
		expect(formatTrackSummary(1, 222_000)).toBe('1 track · 4 min');
		expect(formatTrackSummary(4, 18 * 60_000)).toBe('4 tracks · 18 min');
	});

	it('omits the runtime rather than printing a zero for it', () => {
		// The state a release is in between being created and having any audio.
		expect(formatTrackSummary(0, 0)).toBe('0 tracks');
	});
});
