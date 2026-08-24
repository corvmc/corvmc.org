import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import type { SQL } from 'drizzle-orm';

// A fake `db` that records what the service asked for. drizzle-orm and the
// schema stay real, so the recorded `where` clauses are genuine SQL objects we
// can render and assert on.
const calls = {
	selectWhere: [] as SQL[],
	updateSet: [] as Record<string, unknown>[],
	updateWhere: [] as SQL[],
	groupBySelects: 0
};

let selectRows: unknown[] = [];
let groupedRows: unknown[] = [];

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				// `where` stays chainable: countThreadsByStatus now filters *and*
				// groups, so a where that resolves straight to rows would break it.
				where: (w: SQL) => {
					calls.selectWhere.push(w);
					return {
						groupBy: () => {
							calls.groupBySelects++;
							return Promise.resolve(groupedRows);
						},
						then: (resolve: (v: unknown) => unknown) => resolve(selectRows)
					};
				},
				groupBy: () => {
					calls.groupBySelects++;
					return Promise.resolve(groupedRows);
				}
			})
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: (w: SQL) => {
					calls.updateSet.push(values);
					calls.updateWhere.push(w);
					return Promise.resolve();
				}
			})
		})
	}
}));
vi.mock('$lib/server/db/paginate', () => ({ paginate: vi.fn() }));

const { wakeSnoozedThreads, countThreadsByStatus, updateStatus, getUnresolvedCount } =
	await import('./thread-service');
const { inboxThread } = await import('$lib/server/db/schema/inbox');

/** Render a captured predicate so we can assert on the actual SQL. */
function renderWhere(where: SQL): string {
	const bare = drizzle({} as never);
	return bare.select().from(inboxThread).where(where).toSQL().sql;
}

beforeEach(() => {
	calls.selectWhere = [];
	calls.updateSet = [];
	calls.updateWhere = [];
	calls.groupBySelects = 0;
	selectRows = [];
	groupedRows = [];
});

describe('wakeSnoozedThreads', () => {
	it('only targets snoozed threads whose snooze has elapsed', async () => {
		selectRows = [{ id: 'a' }];
		await wakeSnoozedThreads(new Date('2026-08-03T15:00:00Z'));

		const sql = renderWhere(calls.selectWhere[0]).toLowerCase();
		expect(sql).toContain('"status" = ?');
		expect(sql).toContain('"snoozed_until" is not null');
		expect(sql).toContain('"snoozed_until" <= ?');
	});

	it('reopens due threads and clears the snooze date', async () => {
		const now = new Date('2026-08-03T15:00:00Z');
		selectRows = [{ id: 'a' }, { id: 'b' }];

		const result = await wakeSnoozedThreads(now);

		expect(result).toEqual({ woken: 2 });
		expect(calls.updateSet[0]).toEqual({ status: 'open', snoozedUntil: null, updatedAt: now });
	});

	// A snooze with no date was set by hand and has no due time; sweeping those
	// back into the queue would make the snooze meaningless.
	it('does not run an update when nothing is due', async () => {
		selectRows = [];

		const result = await wakeSnoozedThreads(new Date('2026-08-03T15:00:00Z'));

		expect(result).toEqual({ woken: 0 });
		expect(calls.updateSet).toHaveLength(0);
	});
});

describe('updateStatus', () => {
	// Resolving, snoozing and reopening are all staff saying where the thread
	// stands now, which outranks whatever the last reply left behind.
	it('clears the awaiting-reply marker', async () => {
		await updateStatus('thread-1', 'resolved');

		expect(calls.updateSet[0]).toMatchObject({ status: 'resolved', awaitingReplySince: null });
	});
});

describe('getUnresolvedCount', () => {
	// This is the staff nav badge. It counts open threads *waiting on us*, which
	// is why it can legitimately read lower than the Open tab beside it.
	it('counts open threads that are not awaiting a reply', async () => {
		selectRows = [{ count: 3 }];

		expect(await getUnresolvedCount()).toBe(3);

		const sql = renderWhere(calls.selectWhere[0]).toLowerCase();
		expect(sql).toContain('"status" = ?');
		expect(sql).toContain('"awaiting_reply_since" is null');
	});
});

describe('countThreadsByStatus', () => {
	it('maps grouped rows onto every status and totals them', async () => {
		groupedRows = [
			{ status: 'open', count: 4 },
			{ status: 'resolved', count: 9 }
		];

		const counts = await countThreadsByStatus();

		expect(counts).toEqual({ open: 4, resolved: 9, snoozed: 0, all: 13 });
	});

	it('reports zeroes for an empty inbox', async () => {
		groupedRows = [];

		const counts = await countThreadsByStatus();

		expect(counts).toEqual({ open: 0, resolved: 0, snoozed: 0, all: 0 });
	});
});

describe('staffVisibleThread (rendered SQL)', () => {
	// The other visibility tests assert on the predicate's *shape* with drizzle
	// mocked out. This file keeps drizzle and the schema real, so it can render
	// the thing and check it is valid SQL that says what we meant — the raw
	// EXISTS subquery names `content_flag` by hand, and a typo there would only
	// surface at runtime against a real database.
	it('compiles to a not-direct-or-reported check', async () => {
		const { staffVisibleThread } = await import('./thread-service');
		const rendered = renderWhere(staffVisibleThread);

		expect(rendered).toContain('channel');
		expect(rendered).toContain('content_flag');
		expect(rendered).toContain('entity_type');
		expect(rendered).toContain('entity_id');
		// The two halves are an OR: excluded by default, back in when reported.
		expect(rendered.toLowerCase()).toContain(' or ');
		expect(rendered.toLowerCase()).toContain('exists');
	});

	it('is applied by countThreadsByStatus', async () => {
		calls.selectWhere = [];
		groupedRows = [];
		await countThreadsByStatus();
		expect(calls.selectWhere.length).toBe(1);
		expect(renderWhere(calls.selectWhere[0])).toContain('content_flag');
	});
});
