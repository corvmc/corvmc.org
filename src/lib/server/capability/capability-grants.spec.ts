import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

let selectResults: unknown[][] = [];
const whereClauses: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResults.shift() ?? []);
			}
			if (prop === 'where') {
				return (clause: unknown) => {
					whereClauses.push(clause);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({ db: { select: vi.fn(() => chainable()) } }));

const { committeeAllows, committeeGrantsFor, grantWindow, roleGrantAllows, allowlisted } =
	await import('./capability-grants');

const dialect = new SQLiteSyncDialect();
const rendered = (i: number) => dialect.sqlToQuery(whereClauses[i] as SQL);

const day = 86_400_000;
const showStart = new Date('2026-09-01T02:00:00Z');
const showEnd = new Date('2026-09-01T06:00:00Z');
const shift = (grants: string[]) => ({
	grants,
	startsAt: showStart,
	endsAt: showEnd,
	eventStartsAt: showStart,
	eventEndsAt: showEnd
});

beforeEach(() => {
	selectResults = [];
	whereClauses.length = 0;
});

describe('allowlisted', () => {
	it('drops anything the carrier may not hold, including entries that left the list', () => {
		expect(allowlisted(['event.uploadRecap', 'user.ban', 'sponsor.manage'], 'role')).toEqual([
			'event.uploadRecap'
		]);
		expect(allowlisted(['finance.refund', 'sponsor.manage'], 'committee')).toEqual([
			'sponsor.manage'
		]);
	});
});

describe('committeeGrantsFor', () => {
	it('reads active seats on live committees and filters each list to the allowlist', async () => {
		selectResults = [[{ groupId: 'dev', grants: ['sponsor.manage', 'user.ban'] }]];
		expect(await committeeGrantsFor('u-1')).toEqual([
			{ groupId: 'dev', capabilities: ['sponsor.manage'] }
		]);
		const { sql, params } = rendered(0);
		expect(sql).toContain('"group_member"."status" = ?');
		expect(sql).toContain('"group"."kind" = ?');
		expect(sql).toContain('"group"."deleted_at" is null');
		expect(params).toEqual(expect.arrayContaining(['u-1', 'active', 'committee']));
	});
});

describe('committeeAllows', () => {
	const seats = [{ groupId: 'dev', capabilities: ['sponsor.manage'] }];

	it('allows an org-wide grant with no scope', () => {
		expect(committeeAllows(seats, 'sponsor.manage')).toBe(true);
	});

	it('denies a capability the seat does not carry', () => {
		expect(committeeAllows(seats, 'grant.manage')).toBe(false);
	});

	it('denies a capability that is not committee-grantable, whatever the row says', () => {
		const forged = [{ groupId: 'dev', capabilities: ['event.uploadRecap'] }];
		expect(committeeAllows(forged, 'event.uploadRecap')).toBe(false);
	});

	it('denies with no seats', () => {
		expect(committeeAllows([], 'sponsor.manage')).toBe(false);
	});
});

describe('grantWindow', () => {
	it('runs from the shift start to the grace period after its end', () => {
		expect(grantWindow(shift([]), 7)).toEqual({
			from: showStart,
			until: new Date(showEnd.getTime() + 7 * day)
		});
	});

	it('borrows the event times for an unscheduled work order', () => {
		const row = { ...shift([]), startsAt: null, endsAt: null, eventEndsAt: null };
		expect(grantWindow(row, 1)).toEqual({
			from: showStart,
			until: new Date(showStart.getTime() + day)
		});
	});
});

describe('roleGrantAllows', () => {
	it('allows during the shift', async () => {
		selectResults = [[shift(['event.uploadRecap'])]];
		expect(await roleGrantAllows('u-1', 'event.uploadRecap', 'ev-1', showEnd)).toBe(true);
	});

	it('allows inside the grace period after the shift ends', async () => {
		selectResults = [[shift(['event.uploadRecap'])]];
		const sixDaysOn = new Date(showEnd.getTime() + 6 * day);
		expect(await roleGrantAllows('u-1', 'event.uploadRecap', 'ev-1', sixDaysOn)).toBe(true);
	});

	it('denies once the grace period has expired', async () => {
		selectResults = [[shift(['event.uploadRecap'])]];
		const eightDaysOn = new Date(showEnd.getTime() + 8 * day);
		expect(await roleGrantAllows('u-1', 'event.uploadRecap', 'ev-1', eightDaysOn)).toBe(false);
	});

	it('denies before the shift starts', async () => {
		selectResults = [[shift(['event.uploadRecap'])]];
		const dayBefore = new Date(showStart.getTime() - day);
		expect(await roleGrantAllows('u-1', 'event.uploadRecap', 'ev-1', dayBefore)).toBe(false);
	});

	it('denies when the role does not carry the capability', async () => {
		selectResults = [[shift([])]];
		expect(await roleGrantAllows('u-1', 'event.uploadRecap', 'ev-1', showEnd)).toBe(false);
	});

	it('scopes the read to this user, this event, an accepted signup and a live work order', async () => {
		selectResults = [[]];
		await roleGrantAllows('u-1', 'event.uploadRecap', 'ev-1', showEnd);
		const { sql, params } = rendered(0);
		expect(sql).toContain('"volunteer_signup"."user_id" = ?');
		expect(sql).toContain('"work_order"."event_id" = ?');
		expect(sql).toContain('"volunteer_signup"."status" in (?, ?)');
		expect(sql).toContain('"work_order"."cancelled_at" is null');
		expect(params).toEqual(['u-1', 'ev-1', 'confirmed', 'completed']);
	});

	it('never reads for a capability no role may grant', async () => {
		expect(await roleGrantAllows('u-1', 'sponsor.manage', 'ev-1', showEnd)).toBe(false);
		expect(whereClauses).toHaveLength(0);
	});
});
