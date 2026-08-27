import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// `searchEvents` backs the event picker on the volunteer shift forms. It is a
// picker, not an index, and it deliberately answers a different question than
// `listAll` does — these tests pin the three ways it differs, because every one
// of them is a one-line change away from silently reverting.
//
// No database: the chain is recorded and its predicate rendered to SQL, the
// same technique volunteer-shift-service.spec.ts uses.
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let chainCalls: { method: string; args: unknown[] }[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return (...args: unknown[]) => {
				chainCalls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({ db: { select: () => chainable() } }));

vi.mock('$lib/server/authorization', () => ({
	requireStaff: vi.fn(async () => mockUser({ id: 'staff-1' })),
	requireUser: vi.fn(() => mockUser({ id: 'staff-1' }))
}));

vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: mockUser({ id: 'staff-1' }) },
		url: new URL('http://localhost/staff/volunteer/shifts'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: unknown[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		(handler as any).__ = { type: 'query' };
		return handler as (...args: any[]) => any;
	}
}));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

const { searchEvents } = (await import('$lib/remote/events.remote')) as any;

function rendered() {
	const where = chainCalls.find((c) => c.method === 'where');
	expect(where, 'expected a where clause').toBeDefined();
	return new SQLiteSyncDialect().sqlToQuery(where!.args[0] as SQL);
}

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [];
	chainCalls = [];
});

describe('searchEvents', () => {
	// A one-letter query matches half the calendar. Same threshold as
	// searchMembers and searchBands, so all three pickers behave alike.
	it('says nothing until there are two characters to go on', async () => {
		expect(await searchEvents('o')).toEqual([]);
		expect(await searchEvents('')).toEqual([]);
		expect(chainCalls).toHaveLength(0);
	});

	it('matches on the title', async () => {
		await searchEvents('sludge');

		const { sql, params } = rendered();
		expect(sql).toContain('title');
		expect(params).toContain('%sludge%');
	});

	// Inherited from listAll and load bearing: a community listing still in draft
	// is a member's private working copy, and staff have no business reading it
	// out of a dropdown.
	it('keeps community drafts out', async () => {
		await searchEvents('open mic');

		const { sql, params } = rendered();
		expect(sql).toContain('not');
		expect(params).toContain('community');
		expect(params).toContain('draft');
	});

	// The departure from listAll: that one keeps cancelled and rejected events
	// because it is an admin index. You do not staff a show that isn't happening.
	it('leaves out shows that are not happening', async () => {
		await searchEvents('open mic');

		const { params } = rendered();
		expect(params).toContain('cancelled');
		expect(params).toContain('rejected');
	});

	/**
	 * The other departure. A venue has five rows called "Open Mic Night";
	 * ordering by `startsAt` descending hands back the one furthest in the
	 * future, which is never the one the staffer meant. Sorting by distance from
	 * now puts next Thursday's first and still reaches backwards for a show that
	 * already happened.
	 */
	it('orders by distance from now, not by newest', async () => {
		await searchEvents('open mic');

		const order = chainCalls.find((c) => c.method === 'orderBy');
		expect(order, 'expected an order').toBeDefined();
		const { sql } = new SQLiteSyncDialect().sqlToQuery(order!.args[0] as SQL);
		expect(sql).toContain('abs(');
		expect(sql).toContain('unixepoch()');
		expect(sql).not.toContain('desc');
	});

	// SearchSelect renders its description field verbatim, so the date has to
	// arrive as a string — and formatted on this side, in club time, rather than
	// in whatever zone the staffer's laptop is set to.
	it('hands back a preformatted club-time date', async () => {
		selectResult = [
			{ id: 'event-1', title: 'Sludgefest', startsAt: new Date('2026-06-02T02:00:00Z') }
		];

		const [row] = await searchEvents('sludge');

		expect(row).toEqual({ id: 'event-1', title: 'Sludgefest', when: 'Jun 1, 2026' });
	});
});
