import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * Crew of a show: holding a live volunteer shift on that event. The predicate
 * is the signup, so a dropped, declined, merely-invited or no-show signup does
 * not count, and neither does a shift that was called off.
 */

let selectResults: unknown[][] = [];
let whereArgs: unknown[] = [];
let currentUser: { id: string; name: string } | null = { id: 'vol-1', name: 'Vi Volunteer' };

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(queue());
			if (prop === 'where') {
				return (arg: unknown) => {
					whereArgs.push(arg);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(() => chain(() => selectResults.shift() ?? [])) }
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: currentUser } })
}));

const { isShowCrew, requireShowCrew } = await import('./show-crew');

const dialect = new SQLiteSyncDialect();

beforeEach(() => {
	selectResults = [];
	whereArgs = [];
	currentUser = { id: 'vol-1', name: 'Vi Volunteer' };
});

describe('isShowCrew', () => {
	it('is true when the member holds a live shift on the event', async () => {
		selectResults = [[{ id: 'signup-1' }]];
		expect(await isShowCrew('vol-1', 'event-1')).toBe(true);
	});

	it('is false with no qualifying signup', async () => {
		selectResults = [[]];
		expect(await isShowCrew('vol-1', 'event-1')).toBe(false);
	});

	it('counts only held signups on shifts that were not called off', async () => {
		selectResults = [[]];
		await isShowCrew('vol-1', 'event-1');

		const { sql, params } = dialect.sqlToQuery(whereArgs[0] as SQL);
		expect(sql).toContain('"work_order"."event_id" = ?');
		expect(sql).toContain('"volunteer_signup"."user_id" = ?');
		expect(sql).toContain('"work_order"."cancelled_at" is null');
		expect(params).toEqual(
			expect.arrayContaining(['vol-1', 'event-1', 'claimed', 'confirmed', 'completed'])
		);
		for (const excluded of ['invited', 'declined', 'cancelled', 'no_show']) {
			expect(params).not.toContain(excluded);
		}
	});
});

describe('requireShowCrew', () => {
	it('returns the user when they are on the crew', async () => {
		selectResults = [[{ id: 'signup-1' }]];
		await expect(requireShowCrew('event-1')).resolves.toMatchObject({ id: 'vol-1' });
	});

	it('403s for a member who is not on this show', async () => {
		selectResults = [[]];
		await expect(requireShowCrew('event-1')).rejects.toMatchObject({ status: 403 });
	});

	it('401s with no user, without touching the db', async () => {
		currentUser = null;
		await expect(requireShowCrew('event-1')).rejects.toMatchObject({ status: 401 });
		expect(whereArgs).toHaveLength(0);
	});
});
