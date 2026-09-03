import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// `setInterests` is a diff, so what matters is which rows it decides to write —
// not the SQL. These capture the delete/insert calls and let each test seed what
// the two reads (live roles, then current interests) return.
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];
let insertedValues: unknown[][] = [];
let deleteCalls: number = 0;

// The read tests assert on the SQL the service builds, not on rows the proxy
// hands back — a mock that returns whatever it was queued can't tell a
// role-scoped `since` from a bare `min()`. So record both halves of each query:
// the selection object passed to `db.select(...)` and every chained call.
let selections: (Record<string, unknown> | undefined)[] = [];
let chainCalls: { method: string; args: unknown[] }[] = [];

function chainableSelect() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResultQueue.shift() ?? []);
			}
			return (...args: unknown[]) => {
				chainCalls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

function chainableDelete() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn((selection?: Record<string, unknown>) => {
			selections.push(selection);
			return chainableSelect();
		}),
		insert: vi.fn(() => ({
			values: vi.fn((rows: unknown[]) => {
				insertedValues.push(rows);
				return { onConflictDoNothing: vi.fn(() => Promise.resolve([])) };
			})
		})),
		delete: vi.fn(() => {
			deleteCalls++;
			return chainableDelete();
		})
	}
}));

vi.mock('$lib/server/authorization', () => ({
	topPositionFor: vi.fn(() => null)
}));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
	setInterests,
	listInterestedMembers,
	countInterestsByRole,
	VolunteerInterestValidationError
} from './volunteer-interest-service';
import { VOLUNTEER_MAX_INTERESTS } from '$lib/config';

/** Render a drizzle fragment so a test can read the SQL the service built. */
function render(fragment: unknown) {
	return new SQLiteSyncDialect().sqlToQuery(fragment as SQL);
}

/**
 * The selection object for the query that asked for `key`.
 *
 * Searched rather than indexed: `listInterestedMembers` issues a data query and
 * a count query, and `Promise.all` leaves their order unpinned.
 */
function selectionWith(key: string) {
	return selections.find((sel) => sel && key in sel);
}

/**
 * Queue the reads `setInterests` makes and then run it.
 *
 * There are two, in order: the live-role check — which is `inArray(wanted)`, so
 * it only ever returns roles that were asked for — and the member's current
 * rows. The first is skipped entirely when nothing is ticked, so the queue has
 * to be built against `wanted` rather than stated flat.
 */
function run(
	wanted: string[],
	{ live, current }: { live: string[]; current: string[] }
): Promise<void> {
	// Deduped, like the service does before it queries — otherwise a submission
	// with repeats would queue more rows than the real `inArray` could return.
	const liveHits = [...new Set(wanted)].filter((id) => live.includes(id));
	selectResultQueue = [
		...(wanted.length > 0 ? [liveHits.map((id) => ({ id }))] : []),
		current.map((roleId) => ({ roleId }))
	];
	return setInterests('user-1', wanted);
}

describe('setInterests', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectResultQueue = [];
		insertedValues = [];
		deleteCalls = 0;
	});

	it('inserts only the roles that are new', async () => {
		await run(['a', 'b'], { live: ['a', 'b', 'c'], current: ['a'] });

		expect(insertedValues.flat()).toEqual([{ userId: 'user-1', volunteerRoleId: 'b' }]);
	});

	it('deletes the roles that were unticked', async () => {
		await run(['a'], { live: ['a', 'b'], current: ['a', 'b'] });

		expect(deleteCalls).toBe(1);
		expect(insertedValues).toEqual([]);
	});

	// The whole reason the schema defaults to `[]` instead of requiring one
	// selection: "take me off the list" is a legitimate submission.
	it('clears every interest when nothing is ticked', async () => {
		await run([], { live: ['a', 'b'], current: ['a', 'b'] });

		expect(deleteCalls).toBe(1);
		expect(insertedValues).toEqual([]);
	});

	it('writes nothing when the set is unchanged', async () => {
		await run(['a', 'b'], { live: ['a', 'b'], current: ['a', 'b'] });

		expect(deleteCalls).toBe(0);
		expect(insertedValues).toEqual([]);
	});

	it('ignores duplicate ids in the submission', async () => {
		await run(['a', 'a', 'a'], { live: ['a'], current: [] });

		expect(insertedValues.flat()).toEqual([{ userId: 'user-1', volunteerRoleId: 'a' }]);
	});

	// An archived role isn't offered by the form, so seeing one means a stale page
	// or a hand-crafted post — either way it must not land in the table.
	it('rejects a role that is not live', async () => {
		await expect(run(['a', 'archived'], { live: ['a'], current: [] })).rejects.toThrow(
			VolunteerInterestValidationError
		);
		expect(insertedValues).toEqual([]);
	});

	it('rejects more roles than the cap allows', async () => {
		const tooMany = Array.from({ length: VOLUNTEER_MAX_INTERESTS + 1 }, (_, i) => `role-${i}`);

		await expect(setInterests('user-1', tooMany)).rejects.toThrow(VolunteerInterestValidationError);
		expect(insertedValues).toEqual([]);
	});

	// D1 rejects a statement with more than 100 bound parameters, so a large
	// submission has to arrive as several inserts rather than one.
	it('chunks a large insert', async () => {
		const ids = Array.from({ length: 40 }, (_, i) => `role-${i}`);
		await run(ids, { live: ids, current: [] });

		expect(insertedValues.length).toBeGreaterThan(1);
		expect(insertedValues.flat()).toHaveLength(40);
	});
});

describe('listInterestedMembers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectResultQueue = [];
		selections = [];
		chainCalls = [];
	});

	// On a role detail page "Since" means "since they picked *this* role". The
	// unfiltered table wants the earliest of everything they picked, but reusing
	// that `min()` under a role filter reads as though someone joined the door
	// crew in January when what they did in January was tick Merch.
	it('scopes `since` to the filtered role', async () => {
		await listInterestedMembers({ roleId: 'role-1' });

		const selection = selectionWith('since');
		expect(selection).toBeDefined();

		const { sql, params } = render(selection!.since);
		expect(sql).toContain('volunteer_role_interest');
		expect(params).toContain('role-1');
	});

	it('falls back to the earliest interest when no role is filtered', async () => {
		await listInterestedMembers({});

		const selection = selectionWith('since');
		expect(selection).toBeDefined();

		const { sql, params } = render(selection!.since);
		expect(sql).toContain('min(');
		expect(params).not.toContain('role-1');
	});

	// A filtered member still shows every role they picked — that list is the
	// "also interested in" signal — so the role filter has to stay an EXISTS
	// rather than becoming a WHERE on the joined rows.
	it('keeps the role filter out of the joined rows', async () => {
		await listInterestedMembers({ roleId: 'role-1' });

		const selection = selectionWith('roleNames');
		expect(selection).toBeDefined();
		expect(render(selection!.roleNames).sql).not.toContain('role-1');
	});
});

describe('countInterestsByRole', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectResultQueue = [];
		selections = [];
		chainCalls = [];
	});

	// The counts feed the staff roles table, which lists archived roles too — so
	// a retired role has to come back with its count rather than drop out.
	it('does not filter out archived roles', async () => {
		await countInterestsByRole();

		expect(chainCalls.some((c) => c.method === 'groupBy')).toBe(true);
		expect(chainCalls.some((c) => c.method === 'where')).toBe(false);
	});
});
