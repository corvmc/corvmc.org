import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The station's programming rules, asserted without a database.
 *
 * `pickNextTrack` is pure and exported for exactly this: whether the rotation
 * sounds like a station is a scheduling question, not a SQL one, and the two
 * properties that make it sound like one — never the same band twice running,
 * never the same song while something else is waiting — are invisible in a query
 * plan and obvious here.
 */

type Row = Record<string, unknown>;

const state = {
	results: [] as unknown[][],
	inserted: [] as Row[][],
	deletes: 0
};

function queue(...results: unknown[][]) {
	state.results = results;
}

function chain(rows: unknown[]) {
	const self: Record<string, unknown> = {};
	for (const key of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'leftJoin']) {
		self[key] = () => self;
	}
	self.then = (resolve: (v: unknown) => void) => resolve(rows);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(state.results.shift() ?? []),
		selectDistinct: () => chain(state.results.shift() ?? []),
		insert: () => ({
			values: (rows: Row[]) => {
				state.inserted.push(rows);
				return Promise.resolve([]);
			}
		}),
		delete: () => ({
			where: () => ({
				returning: () => {
					state.deletes += 1;
					return Promise.resolve(state.results.shift() ?? []);
				}
			})
		})
	}
}));

vi.mock('drizzle-orm', () => ({
	and: (...p: unknown[]) => `and(${p.join(',')})`,
	asc: (c: unknown) => `asc(${String(c)})`,
	desc: (c: unknown) => `desc(${String(c)})`,
	eq: (a: unknown, b: unknown) => `eq(${String(a)},${String(b)})`,
	gt: (a: unknown, b: unknown) => `gt(${String(a)},${String(b)})`,
	lt: (a: unknown, b: unknown) => `lt(${String(a)},${String(b)})`,
	lte: (a: unknown, b: unknown) => `lte(${String(a)},${String(b)})`,
	isNull: (a: unknown) => `isNull(${String(a)})`,
	sql: Object.assign(
		(strings: TemplateStringsArray, ...values: unknown[]) =>
			strings.raw.join('?') + values.map(String).join(''),
		{ raw: (s: string) => s }
	)
}));

vi.mock('$lib/server/storage', () => ({ resolveImageUrl: () => null }));

// Hoisted: an in-test `await import` on a cold Vite cache is what a
// "timed out in 5000ms" failure in this project usually is.
const radio = await import('./radio-service');

const track = (id: string, groupId: string, lastPlayedAt: Date | null, durationMs = 180_000) => ({
	trackId: id,
	groupId,
	lastPlayedAt,
	durationMs
});

beforeEach(() => {
	state.results = [];
	state.inserted = [];
	state.deletes = 0;
});

describe('pickNextTrack', () => {
	it('returns nothing when the pool is empty', () => {
		// The state before launch, and the reason the station has a staff toggle.
		expect(radio.pickNextTrack([], null)).toBeNull();
	});

	it('prefers a track that has never played', () => {
		const played = track('old', 'band-1', new Date('2026-01-01'));
		const never = track('new', 'band-2', null);
		// A record uploaded this morning should be on the air today, not after
		// everything else has had a turn.
		expect(radio.pickNextTrack([played, never], null, () => 0)?.trackId).toBe('new');
	});

	it('orders by how long ago, coldest first', () => {
		const recent = track('recent', 'band-1', new Date('2026-03-01'));
		const stale = track('stale', 'band-2', new Date('2026-01-01'));
		expect(radio.pickNextTrack([recent, stale], null, () => 0)?.trackId).toBe('stale');
	});

	it('never plays the same band twice in a row when there is an alternative', () => {
		const pool = [
			track('a1', 'band-1', new Date('2026-01-01')),
			track('a2', 'band-1', new Date('2026-01-02')),
			track('b1', 'band-2', new Date('2026-06-01'))
		];
		// `band-1` holds the two coldest slots, so a scheduler that only sorted
		// would play them back to back.
		for (let i = 0; i < 10; i++) {
			const pick = radio.pickNextTrack(pool, 'band-1', () => i / 10);
			expect(pick?.groupId).toBe('band-2');
		}
	});

	it('still plays a band back to back when it is the only one', () => {
		// A station with one band on it has to play that band. Refusing would
		// leave dead air, which is worse than a repeat.
		const pool = [track('a1', 'band-1', null), track('a2', 'band-1', null)];
		expect(radio.pickNextTrack(pool, 'band-1', () => 0)).not.toBeNull();
	});

	it('draws from the coldest ten rather than always the single coldest', () => {
		// Straight least-recently-played is a fixed rotation — the same running
		// order every cycle, which is the one thing a station must not sound like.
		const pool = Array.from({ length: 20 }, (_, i) =>
			track(`t${i}`, `band-${i}`, new Date(2026, 0, i + 1))
		);
		const picks = new Set<string>();
		for (let i = 0; i < 10; i++) picks.add(radio.pickNextTrack(pool, null, () => i / 10)!.trackId);
		expect(picks.size).toBeGreaterThan(1);

		// ...but bounded: the eleventh-coldest and beyond are not candidates, so
		// nothing goes unplayed while something else repeats.
		expect([...picks].every((id) => Number(id.slice(1)) < 10)).toBe(true);
	});
});

describe('scheduleRadio', () => {
	const NOW = new Date('2026-09-03T12:00:00Z');

	it('schedules nothing and says so when no track is eligible', async () => {
		queue([], []); // prune returns nothing, then an empty pool
		const result = await radio.scheduleRadio({ now: NOW });

		expect(result).toMatchObject({ scheduled: 0, poolEmpty: true });
		expect(state.inserted).toHaveLength(0);
	});

	it('fills forward from now when the timetable is empty', async () => {
		queue(
			[], // prune
			[{ trackId: 't1', durationMs: 180_000, groupId: 'b1', lastPlayedAt: null }], // pool
			[] // no existing entries
		);
		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * 60_000, random: () => 0 });

		const rows = state.inserted.flat();
		expect(rows.length).toBeGreaterThan(0);
		expect((rows[0].startsAt as Date).getTime()).toBe(NOW.getTime());
	});

	it('leaves no gap between one track and the next', async () => {
		queue(
			[],
			[
				{ trackId: 't1', durationMs: 120_000, groupId: 'b1', lastPlayedAt: null },
				{ trackId: 't2', durationMs: 150_000, groupId: 'b2', lastPlayedAt: null }
			],
			[]
		);
		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * 60_000, random: () => 0 });

		// Dead air between entries is the failure a listener notices immediately.
		const rows = state.inserted.flat();
		for (let i = 1; i < rows.length; i++) {
			expect((rows[i].startsAt as Date).getTime()).toBe((rows[i - 1].endsAt as Date).getTime());
		}
	});

	it('appends after an existing schedule rather than overwriting it', async () => {
		const existingEnd = new Date(NOW.getTime() + 5 * 60_000);
		queue(
			[],
			[{ trackId: 't1', durationMs: 120_000, groupId: 'b1', lastPlayedAt: null }],
			[{ endsAt: existingEnd, trackId: 't-earlier' }]
		);
		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * 60_000, random: () => 0 });

		// Rows already handed out do not move — that is the whole reason the
		// schedule is materialized instead of shuffled on demand.
		const rows = state.inserted.flat();
		expect((rows[0].startsAt as Date).getTime()).toBe(existingEnd.getTime());
	});

	it('restarts from now when the last entry has already finished', async () => {
		const staleEnd = new Date(NOW.getTime() - 60 * 60_000);
		queue(
			[],
			[{ trackId: 't1', durationMs: 120_000, groupId: 'b1', lastPlayedAt: null }],
			[{ endsAt: staleEnd, trackId: 't-old' }]
		);
		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * 60_000, random: () => 0 });

		// Backfilling an idle hour would make the station open by "playing" an
		// hour of music nobody heard, and burn the rotation doing it.
		const rows = state.inserted.flat();
		expect((rows[0].startsAt as Date).getTime()).toBe(NOW.getTime());
	});

	it('does not fill the horizon with one track on repeat', async () => {
		// The bug the in-loop `lastPlayedAt` update exists to prevent: without it
		// every pick re-reads the same coldest track and the next hour is one song.
		queue(
			[],
			[
				{ trackId: 't1', durationMs: 60_000, groupId: 'b1', lastPlayedAt: null },
				{ trackId: 't2', durationMs: 60_000, groupId: 'b2', lastPlayedAt: null },
				{ trackId: 't3', durationMs: 60_000, groupId: 'b3', lastPlayedAt: null }
			],
			[]
		);
		await radio.scheduleRadio({ now: NOW, horizonMs: 6 * 60_000, random: () => 0 });

		const ids = state.inserted.flat().map((r) => r.trackId);
		expect(new Set(ids).size).toBeGreaterThan(1);
	});

	it('stops at the horizon rather than running away on short tracks', async () => {
		queue(
			[],
			[
				{ trackId: 't1', durationMs: 30_000, groupId: 'b1', lastPlayedAt: null },
				{ trackId: 't2', durationMs: 30_000, groupId: 'b2', lastPlayedAt: null }
			],
			[]
		);
		await radio.scheduleRadio({ now: NOW, horizonMs: 5 * 60_000, random: () => 0 });

		const rows = state.inserted.flat();
		const last = rows[rows.length - 1];
		// The first entry to reach past the horizon is the last one written.
		expect((last.startsAt as Date).getTime()).toBeLessThan(NOW.getTime() + 5 * 60_000);
	});

	it('prunes aged-out history on every run', async () => {
		queue([{ id: 'p1' }, { id: 'p2' }], []);
		const result = await radio.scheduleRadio({ now: NOW });

		// Without this the table becomes a permanent log of every song ever played.
		expect(state.deletes).toBe(1);
		expect(result.pruned).toBe(2);
	});

	it('chunks its inserts under D1’s bound-parameter cap', async () => {
		queue([], [{ trackId: 't1', durationMs: 30_000, groupId: 'b1', lastPlayedAt: null }], []);
		await radio.scheduleRadio({ now: NOW, horizonMs: 60 * 60_000, random: () => 0 });

		// D1 caps a statement at 100 bound parameters and these rows are 4 columns
		// wide, so a single multi-row insert of a full horizon would be rejected.
		for (const batch of state.inserted) expect(batch.length).toBeLessThanOrEqual(20);
	});
});
