import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `market.host` as a shift-role grant with a lead time (#2993), through the
 * real resolver against a migrated SQLite: a market's vendor host decides,
 * checks in and takes fees for that market only, from the role's lead time
 * before the market until its grace period after.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { roleGrantAllows } = await import('./capability-grants');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const marketStart = new Date('2026-12-05T17:00:00Z');
const marketEnd = new Date(marketStart.getTime() + 5 * HOUR);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

function market(id: string) {
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		 values ('${id}', 'Market ${id}', ${secs(marketStart)}, ${secs(marketEnd)}, 'published', 'cmc', 'market', 'staff-1')`
	);
}

/** A vendor host task on `eventId`, in a role that grants from `leadDays` before. */
function hostTask(id: string, eventId: string, leadDays: number) {
	const roleId = `host-${leadDays}`;
	sqlite.exec(
		`insert or ignore into volunteer_role (id, name, grant_lead_days)
		 values ('${roleId}', 'Vendor host ${leadDays}', ${leadDays})`
	);
	sqlite.exec(
		`insert or ignore into volunteer_role_capability (volunteer_role_id, capability)
		 values ('${roleId}', 'market.host')`
	);
	sqlite.exec(
		`insert into work_order (id, volunteer_role_id, event_id) values ('${id}', '${roleId}', '${eventId}')`
	);
	sqlite.exec(
		`insert into volunteer_shift (id, work_order_id, starts_at, ends_at)
		 values ('${id}-shift', '${id}', ${secs(marketStart)}, ${secs(marketEnd)})`
	);
}

beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'work_order_assignee',
		'volunteer_shift',
		'work_order',
		'volunteer_role_capability',
		'volunteer_role',
		'event_listing'
	])
		sqlite.exec(`delete from ${t}`);
	market('a');
	market('b');
	hostTask('host-a', 'a', 30);
	sqlite.exec(`insert into work_order_assignee (work_order_id, user_id) values ('host-a', 'host')`);
});

const hosts = (eventId: string, now: Date, userId = 'host') =>
	roleGrantAllows(userId, 'market.host', eventId, now);

describe('market.host through a vendor host role', () => {
	it('allows the host of market A on market A, inside the lead time', async () => {
		expect(await hosts('a', new Date(marketStart.getTime() - 20 * DAY))).toBe(true);
		expect(await hosts('a', new Date(marketStart.getTime() - 30 * DAY))).toBe(true);
		expect(await hosts('a', marketStart)).toBe(true);
	});

	it('refuses the host of market A on market B', async () => {
		expect(await hosts('b', new Date(marketStart.getTime() - 20 * DAY))).toBe(false);
		expect(await hosts('b', marketStart)).toBe(false);
	});

	it('refuses the host before the lead time', async () => {
		expect(await hosts('a', new Date(marketStart.getTime() - 30 * DAY - HOUR))).toBe(false);
	});

	it('applies the lead time to a confirmed signup as well as an assignment', async () => {
		sqlite.exec(
			`insert into volunteer_signup (id, shift_id, user_id, status)
			 values ('su', 'host-a-shift', 'vol', 'confirmed')`
		);
		expect(await hosts('a', new Date(marketStart.getTime() - 20 * DAY), 'vol')).toBe(true);
		expect(await hosts('a', new Date(marketStart.getTime() - 31 * DAY), 'vol')).toBe(false);
	});

	it('keeps a role with no lead time shut until its shift starts', async () => {
		hostTask('host-b', 'b', 0);
		sqlite.exec(
			`insert into work_order_assignee (work_order_id, user_id) values ('host-b', 'host')`
		);
		expect(await hosts('b', new Date(marketStart.getTime() - HOUR))).toBe(false);
		expect(await hosts('b', marketStart)).toBe(true);
	});
});
