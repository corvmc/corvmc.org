/**
 * Calendar-day deadlines, shared by the sponsor and grant modules.
 *
 * A deadline is a `YYYY-MM-DD` string, a day in Corvallis with no time. ISO
 * days compare correctly as strings, so nothing here parses one into a `Date`
 * except for display. Client-safe: no server imports.
 */
import { formatDateShortYear } from './format';

export interface Deadline<K extends string = string> {
	kind: K;
	/** `YYYY-MM-DD` */
	on: string;
	/** The day has passed. Today itself is not overdue. */
	overdue: boolean;
}

export function due<K extends string>(kind: K, on: string, today: string): Deadline<K> {
	return { kind, on, overdue: on < today };
}

/** The calendar day `n` days after `iso`. Arithmetic in UTC, so DST cannot shift it. */
export function addIsoDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

/** The soonest of the given deadlines, skipping missing ones. */
export function earliest<K extends string>(
	...deadlines: (Deadline<K> | null)[]
): Deadline<K> | null {
	let best: Deadline<K> | null = null;
	for (const d of deadlines) if (d && (!best || d.on < best.on)) best = d;
	return best;
}

/** A comparator: soonest deadline first, undated rows last, ties by `name`. */
export function byDeadline<T extends { deadline: Deadline | null }>(name: (row: T) => string) {
	return (a: T, b: T): number => {
		if (a.deadline && b.deadline && a.deadline.on !== b.deadline.on) {
			return a.deadline.on < b.deadline.on ? -1 : 1;
		}
		if (a.deadline && !b.deadline) return -1;
		if (b.deadline && !a.deadline) return 1;
		return name(a).localeCompare(name(b));
	};
}

/** A `YYYY-MM-DD` read as that calendar day, not as UTC midnight. */
export function formatIsoDay(iso: string | null): string {
	return iso ? formatDateShortYear(new Date(`${iso}T12:00:00`)) : '—';
}
