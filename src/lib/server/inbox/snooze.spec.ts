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
						// `undoLastDisposition` reads one row by id.
						limit: () => Promise.resolve(selectRows),
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

const {
	wakeSnoozedThreads,
	countThreadsByStatus,
	updateStatus,
	getUnresolvedCount,
	assignThread,
	setAwaitingReply,
	undoLastDisposition,
	nudgeStaleAwaiting
} = await import('./thread-service');
const { inboxThread } = await import('$lib/server/db/schema/inbox');

/** Render a captured SET-side fragment — `undoState` is raw SQL, not a value. */
function renderSet(fragment: SQL): string {
	const bare = drizzle({} as never);
	return bare.select().from(inboxThread).where(fragment).toSQL().sql;
}

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

	// The date is deliberately left behind. An open thread carrying a snooze date
	// in the past is how `openReason()` recognises one that came back on its own
	// — clearing it here would make "Snooze expired" indistinguishable from
	// "never answered", which are different reasons to be looking at a thread.
	it('reopens due threads without erasing the snooze date', async () => {
		const now = new Date('2026-08-03T15:00:00Z');
		selectRows = [{ id: 'a' }, { id: 'b' }];

		const result = await wakeSnoozedThreads(now);

		expect(result).toEqual({ woken: 2 });
		expect(calls.updateSet[0]).toEqual({ status: 'open', updatedAt: now });
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
	it('maps grouped rows onto every view and totals them', async () => {
		groupedRows = [
			{ status: 'open', awaiting: 0, count: 4 },
			{ status: 'resolved', awaiting: 0, count: 9 }
		];

		const counts = await countThreadsByStatus();

		expect(counts).toEqual({ open: 4, resolved: 9, snoozed: 0, all: 13 });
	});

	// The split the whole queue turns on: both halves are `status = 'open'` in
	// the database, and only the marker tells Open (needs a human) from parked
	// (the ball is with the contact, so it counts under Snoozed beside the
	// threads on a date). Folding them together is what the Open tab used to do,
	// and it is why the tab and the nav badge disagreed.
	it('counts an awaiting-marked open row under Snoozed', async () => {
		groupedRows = [
			{ status: 'open', awaiting: 0, count: 4 },
			{ status: 'open', awaiting: 1, count: 6 }
		];

		const counts = await countThreadsByStatus();

		expect(counts).toMatchObject({ open: 4, snoozed: 6, all: 10 });
	});

	// A resolved thread can still carry a stale marker — `updateStatus` clears
	// it, but an older row need not have gone through that path, and undo can put
	// one back. It must not land in the parked bucket regardless, which is the
	// same rule `parkedCondition` follows below.
	it('ignores the marker on anything that is not open', async () => {
		groupedRows = [{ status: 'resolved', awaiting: 1, count: 3 }];

		const counts = await countThreadsByStatus();

		expect(counts).toMatchObject({ resolved: 3, snoozed: 0, all: 3 });
	});

	it('reports zeroes for an empty inbox', async () => {
		groupedRows = [];

		const counts = await countThreadsByStatus();

		expect(counts).toEqual({ open: 0, resolved: 0, snoozed: 0, all: 0 });
	});
});

describe('parkedCondition (rendered SQL)', () => {
	// The Snoozed view, and the one predicate `threadConditions` cannot express
	// as an AND of the two columns. Rendered rather than shape-checked because
	// the interesting half is which statuses it names: 'snoozed' and 'open',
	// never 'resolved' — a resolved row carrying a stale marker stays resolved,
	// exactly as the count above insists.
	it('is snoozed, or open and awaiting a reply', async () => {
		const { parkedCondition } = await import('./thread-service');
		const bare = drizzle({} as never);
		const compiled = bare.select().from(inboxThread).where(parkedCondition).toSQL();

		expect(compiled.sql.toLowerCase()).toContain(' or ');
		expect(compiled.sql.toLowerCase()).toContain('"awaiting_reply_since" is not null');
		expect(compiled.params).toEqual(['snoozed', 'open']);
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

describe('undo', () => {
	// The snapshot is written by the same UPDATE that moves the thread. On D1
	// there is no transaction to hold a read and a write together, so a separate
	// SELECT would leave a window where the thread has moved and its way back
	// has not been recorded.
	it('every disposition records what it is about to overwrite', async () => {
		await updateStatus('thread-1', 'resolved');
		await setAwaitingReply('thread-1', true);
		await assignThread('thread-1', 'user-9');

		expect(calls.updateSet).toHaveLength(3);
		for (const set of calls.updateSet) {
			const rendered = renderSet(set.undoState as SQL).toLowerCase();
			expect(rendered).toContain('json_object');
			// All four dispositional fields, or undo restores a partial thread.
			expect(rendered).toContain('status');
			expect(rendered).toContain('snoozed_until');
			expect(rendered).toContain('awaiting_reply_since');
			expect(rendered).toContain('assigned_to_user_id');
		}
	});

	it('restores the snapshot and spends it', async () => {
		selectRows = [
			{
				undoState: {
					status: 'open',
					snoozedUntil: null,
					awaitingReplySince: 1_788_000_000,
					assignedToUserId: 'user-3'
				}
			}
		];

		expect(await undoLastDisposition('thread-1')).toBe(true);
		expect(calls.updateSet[0]).toMatchObject({
			status: 'open',
			snoozedUntil: null,
			awaitingReplySince: new Date(1_788_000_000 * 1000),
			assignedToUserId: 'user-3',
			// Cleared, so a second ⌘Z is a no-op rather than a replay.
			undoState: null
		});
	});

	// Pressing ⌘Z twice, or on a thread nothing has happened to. Not an error:
	// the caller stays quiet on false.
	it('reports nothing to undo rather than writing', async () => {
		selectRows = [{ undoState: null }];

		expect(await undoLastDisposition('thread-1')).toBe(false);
		expect(calls.updateSet).toHaveLength(0);
	});

	// The column is JSON in a text column and nothing stops an older row holding
	// a shape this code never wrote.
	it('refuses a snapshot it cannot parse', async () => {
		selectRows = [{ undoState: { status: 'not-a-status' } }];

		expect(await undoLastDisposition('thread-1')).toBe(false);
		expect(calls.updateSet).toHaveLength(0);
	});
});

describe('nudgeStaleAwaiting', () => {
	// The safety net under the default send. Only open threads, only ones whose
	// marker is older than the window — a thread snoozed with a date has its own
	// return trip and must not be pulled back early.
	it('targets open threads whose awaiting marker has gone stale', async () => {
		selectRows = [{ id: 'a' }];
		await nudgeStaleAwaiting(new Date('2026-09-10T09:00:00Z'));

		const sql = renderWhere(calls.selectWhere[0]).toLowerCase();
		expect(sql).toContain('"status" = ?');
		expect(sql).toContain('"awaiting_reply_since" is not null');
		expect(sql).toContain('"awaiting_reply_since" <= ?');
	});

	// Not a disposition anybody took, so it leaves no way back — an undo
	// snapshot here would let ⌘Z on some other thread reach into the cron's work.
	it('clears the marker without recording an undo', async () => {
		const now = new Date('2026-09-10T09:00:00Z');
		selectRows = [{ id: 'a' }, { id: 'b' }];

		expect(await nudgeStaleAwaiting(now)).toEqual({ nudged: 2 });
		expect(calls.updateSet[0]).toEqual({ awaitingReplySince: null, updatedAt: now });
	});

	it('does not run an update when nothing is stale', async () => {
		selectRows = [];

		expect(await nudgeStaleAwaiting(new Date())).toEqual({ nudged: 0 });
		expect(calls.updateSet).toHaveLength(0);
	});
});
