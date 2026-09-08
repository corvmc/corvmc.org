/**
 * Track-length formatting. Client-safe: no server imports.
 *
 * Deliberately not in `format.ts` beside `formatDuration`, which takes two dates
 * and answers in hours — a different question with a different unit. Track
 * length is milliseconds to a clock reading, and conflating them is how "3:42"
 * becomes "0.06 hrs".
 */

/** 222000 → "3:42". Hours appear only when there are some: 3900000 → "1:05:00". */
export function formatTrackLength(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return '0:00';
	const total = Math.round(ms / 1000);
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);

	const pad = (n: number) => String(n).padStart(2, '0');
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * A record's runtime, rounded for a summary line: "38 min", "1 hr 4 min".
 *
 * Rounds to the nearest minute rather than truncating, so a 5-track EP does not
 * read as four minutes shorter than the sum of the times printed beside it.
 */
export function formatRuntime(ms: number): string {
	const minutes = Math.round(ms / 60000);
	if (minutes < 1) return 'under a minute';
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "4 tracks · 18 min", or just the count when nothing has a duration yet. */
export function formatTrackSummary(trackCount: number, durationMs: number): string {
	const tracks = `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`;
	return durationMs > 0 ? `${tracks} · ${formatRuntime(durationMs)}` : tracks;
}
