/**
 * Upcoming until it ends, nearest first; past, newest first. The rule every
 * reservation list already uses (#3138). A row with no end counts as ending
 * when it starts.
 */
export function splitUpcoming<T extends { startsAt: Date; endsAt: Date | null }>(
	rows: T[],
	now: Date
): { upcoming: T[]; past: T[] } {
	const ends = (r: T) => (r.endsAt ?? r.startsAt).getTime();
	const upcoming = rows
		.filter((r) => ends(r) >= now.getTime())
		.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	const past = rows
		.filter((r) => ends(r) < now.getTime())
		.toSorted((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
	return { upcoming, past };
}
