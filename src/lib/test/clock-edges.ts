// Named instants where club-time code breaks, and runners that sweep a spec
// body across them. Club time is America/Los_Angeles; CI and Workers run in
// UTC, so a spec pinned at midday cannot see a day-boundary bug.
// See docs/development/conventions.md#time-code-runs-at-its-edges.

import { resetLocalTimeZone } from '@internationalized/date';
import { it, vi } from 'vitest';

export type ClockEdge = {
	/** A fresh `Date` on every read, so a spec that mutates one cannot leak it. */
	readonly at: Date;
	readonly iso: string;
	/** The club's calendar day at this instant, `YYYY-MM-DD`. */
	readonly clubDate: string;
	/** The club's wall clock at this instant, 24h `HH:MM`. */
	readonly clubTime: string;
};

function edge(iso: string, clubDate: string, clubTime: string): ClockEdge {
	return {
		get at() {
			return new Date(iso);
		},
		iso,
		clubDate,
		clubTime
	};
}

export const clockEdges = {
	/** The control: club, UTC and most viewers agree on the day. */
	noon: edge('2026-06-15T19:00:00Z', '2026-06-15', '12:00'),
	/** 17:30 PDT, already the next day in UTC. */
	pacificEveningAfterUtcMidnight: edge('2026-06-16T00:30:00Z', '2026-06-15', '17:30'),
	/** 01:30 PST on spring-forward day, the last half hour before the skip. */
	springForwardBefore: edge('2026-03-08T09:30:00Z', '2026-03-08', '01:30'),
	/** 03:00 PDT: 02:00–02:59 never happens, so this is the first instant after it. */
	springForward: edge('2026-03-08T10:00:00Z', '2026-03-08', '03:00'),
	springForwardAfter: edge('2026-03-08T10:30:00Z', '2026-03-08', '03:30'),
	/** 00:30 PDT on fall-back day. */
	fallBackBefore: edge('2026-11-01T07:30:00Z', '2026-11-01', '00:30'),
	/** The second 01:30, in PST: the repeated hour, an hour after the first. */
	fallBack: edge('2026-11-01T09:30:00Z', '2026-11-01', '01:30'),
	fallBackAfter: edge('2026-11-01T10:30:00Z', '2026-11-01', '02:30'),
	/** 23:30 PST on the last day of February, already March in UTC. */
	monthEnd: edge('2026-03-01T07:30:00Z', '2026-02-28', '23:30'),
	/** 23:30 PST on Dec 31, already next year in UTC. */
	yearEnd: edge('2027-01-01T07:30:00Z', '2026-12-31', '23:30')
} as const satisfies Record<string, ClockEdge>;

export type ClockEdgeName = keyof typeof clockEdges;

export const clockEdgeNames = Object.keys(clockEdges) as ClockEdgeName[];

/**
 * Viewer zones that disagree with the club: UTC (CI, Workers), both ends of
 * the date line, and the club itself as a control.
 */
export const viewerTimeZones = [
	'UTC',
	'America/Los_Angeles',
	'Pacific/Kiritimati',
	'Pacific/Pago_Pago'
] as const;

/**
 * Runs `fn` with the process zone set to `zone`, restoring it afterwards even
 * when `fn` throws. Server project only: the browser has no settable zone. An
 * `Intl.DateTimeFormat` built before the switch keeps the zone it was built in.
 */
export async function withTimeZone<T>(zone: string, fn: () => T | Promise<T>): Promise<T> {
	if (typeof process === 'undefined' || !process.env) {
		throw new Error('withTimeZone needs a Node process; it cannot run in the client project');
	}
	const previous = process.env.TZ;
	process.env.TZ = zone;
	// @internationalized/date caches the process zone on first use, then reads
	// `Date` local fields for it: a stale cache shifts every instant it builds.
	resetLocalTimeZone();
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
		resetLocalTimeZone();
	}
}

type EdgeOptions = {
	/** Fake `Date` and set the system time to the edge before `fn` runs. */
	fakeTimers?: boolean;
	/** A subset of edges, when the others are meaningless for the code under test. */
	only?: readonly ClockEdgeName[];
	/** Also cross every edge with these process zones (server project only). */
	zones?: readonly string[];
};

export type ClockEdgeCase = ClockEdge & { name: ClockEdgeName; zone?: string };

/** One `it` per clock edge (times each zone, when `zones` is given). */
export function forEachClockEdge(
	title: string,
	fn: (edge: ClockEdgeCase) => unknown,
	options: EdgeOptions = {}
): void {
	const names = options.only ?? clockEdgeNames;
	const zones: readonly (string | undefined)[] = options.zones ?? [undefined];
	const cases = names.flatMap((name) => zones.map((zone) => ({ name, zone })));

	it.each(cases)(`${title} at $name${options.zones ? ' in $zone' : ''}`, async ({ name, zone }) => {
		const e = clockEdges[name];
		const run = async () => {
			if (options.fakeTimers) {
				vi.useFakeTimers({ toFake: ['Date'] });
				vi.setSystemTime(e.at);
			}
			try {
				await fn({ name, zone, at: e.at, iso: e.iso, clubDate: e.clubDate, clubTime: e.clubTime });
			} finally {
				if (options.fakeTimers) vi.useRealTimers();
			}
		};
		await (zone === undefined ? run() : withTimeZone(zone, run));
	});
}

/** One `it` per viewer zone, each with the process zone set and restored. */
export function forEachTimeZone(
	title: string,
	fn: (zone: string) => unknown,
	zones: readonly string[] = viewerTimeZones
): void {
	it.each(zones)(`${title} in %s`, async (zone) => {
		await withTimeZone(zone, () => fn(zone));
	});
}

/** `YYYY-MM-DD` plus `days`, as calendar arithmetic with no zone involved. */
export function addCalendarDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
