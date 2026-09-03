/**
 * How the station chooses what to play next, and nothing else.
 *
 * Split from `radio-service.ts` for the reason `storage-keys.ts` is split from
 * `storage.ts`: these are pure functions with no database and no environment, so
 * they can be called for real from a spec that mocks the I/O — and, more to the
 * point, from `scripts/seed/audio.ts`, which runs under plain tsx with no `$lib`
 * alias map and therefore cannot import anything that reaches for `$lib/server/db`.
 *
 * That matters because the alternative is two copies of the rotation rules, one
 * in the service and one in the seed, drifting until local data stops behaving
 * like production. One copy, imported by relative path from the seed and by
 * alias from the app.
 *
 * **No imports. Keep it that way.**
 */

export type EligibleTrack = {
	trackId: string;
	durationMs: number;
	groupId: string;
	lastPlayedAt: Date | null;
};

export type ScheduledEntry = {
	trackId: string;
	startsAt: Date;
	endsAt: Date;
};

/**
 * How many of the least-recently-played tracks the pick is drawn from.
 *
 * Straight least-recently-played would be a fixed rotation — the same running
 * order every cycle, which is the one thing a station must not sound like.
 * Straight random would clump. Drawing from the coldest ten is varied and still
 * bounded: nothing goes unplayed while something else repeats.
 */
export const CANDIDATE_POOL = 10;

/**
 * The most entries one scheduling pass will write.
 *
 * Bounded independently of the horizon: a pool of thirty-second tracks would
 * otherwise make the loop as long as the horizon divided by thirty seconds.
 */
export const MAX_ENTRIES_PER_RUN = 200;

/** Choose the next track, or null when nothing is eligible. */
export function pickNextTrack(
	eligible: EligibleTrack[],
	previousGroupId: string | null,
	random: () => number = Math.random
): EligibleTrack | null {
	if (eligible.length === 0) return null;

	// Never played sorts first: a record uploaded this morning should be on the
	// air today, not after everything else has had a turn.
	const coldest = [...eligible].sort((a, b) => {
		const at = a.lastPlayedAt?.getTime() ?? -Infinity;
		const bt = b.lastPlayedAt?.getTime() ?? -Infinity;
		return at - bt;
	});

	const pool = coldest.slice(0, CANDIDATE_POOL);

	// Avoid two tracks by the same band in a row — but only when there is
	// something else to play. A station with one band on it still has to play
	// that band; refusing would leave dead air, which is worse than a repeat.
	const withoutRepeat = pool.filter((t) => t.groupId !== previousGroupId);
	const from = withoutRepeat.length > 0 ? withoutRepeat : pool;

	return from[Math.floor(random() * from.length)] ?? null;
}

/**
 * Lay out entries end to end from `from` until they reach `horizon`.
 *
 * `eligible` is **mutated** as it goes — each pick's `lastPlayedAt` is set to the
 * slot it just took. That is the point rather than an accident: without it every
 * pick re-reads the same coldest track and the next hour is one song on repeat.
 * Callers pass a fresh array read from the database, so nothing outside this call
 * sees the mutation.
 */
export function buildSchedule(
	eligible: EligibleTrack[],
	from: Date,
	horizon: Date,
	previousGroupId: string | null = null,
	random: () => number = Math.random
): ScheduledEntry[] {
	const entries: ScheduledEntry[] = [];
	let cursor = from;
	let previous = previousGroupId;

	while (cursor < horizon && entries.length < MAX_ENTRIES_PER_RUN) {
		const next = pickNextTrack(eligible, previous, random);
		if (!next) break;

		const startsAt = cursor;
		const endsAt = new Date(startsAt.getTime() + next.durationMs);
		entries.push({ trackId: next.trackId, startsAt, endsAt });

		next.lastPlayedAt = startsAt;
		previous = next.groupId;
		cursor = endsAt;
	}

	return entries;
}
