import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `finance.collect` as a door-shift role grant (#1630), through the real
 * resolver against a migrated SQLite: who may take card payments at the door,
 * for which show, and when.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { roleGrantAllows } = await import('./capability-grants');

const HOUR = 3_600_000;
const showStart = new Date('2026-10-02T02:00:00Z');
const shiftStart = new Date(showStart.getTime() - HOUR);
const shiftEnd = new Date(showStart.getTime() + 3 * HOUR);
const during = new Date(showStart.getTime() + HOUR);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

function show(id: string) {
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		 values ('${id}', 'Show ${id}', ${secs(showStart)}, ${secs(shiftEnd)}, 'published', 'cmc', 'show', 'staff-1')`
	);
}

function doorShift(id: string, eventId: string, grants: string[] = ['finance.collect']) {
	const roleId = `role-${grants.join('-') || 'none'}`;
	sqlite.exec(
		`insert or ignore into volunteer_role (id, name) values ('${roleId}', 'Door ${grants.join('-')}')`
	);
	for (const cap of grants)
		sqlite.exec(
			`insert or ignore into volunteer_role_capability (volunteer_role_id, capability)
			 values ('${roleId}', '${cap}')`
		);
	sqlite.exec(
		`insert into work_order (id, volunteer_role_id, event_id, starts_at, ends_at)
		 values ('${id}', 'role-${grants.join('-') || 'none'}', '${eventId}', ${secs(shiftStart)}, ${secs(shiftEnd)})`
	);
}

function signup(shiftId: string, userId: string, status: string) {
	sqlite.exec(
		`insert into volunteer_signup (id, shift_id, user_id, status)
		 values ('${shiftId}-${userId}', '${shiftId}', '${userId}', '${status}')`
	);
}

beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'work_order',
		'volunteer_role_capability',
		'volunteer_role',
		'event_listing'
	])
		sqlite.exec(`delete from ${t}`);
	show('tonight');
	show('other');
	doorShift('door-tonight', 'tonight');
	doorShift('door-other', 'other');
});

const collect = (userId: string, eventId: string, now: Date) =>
	roleGrantAllows(userId, 'finance.collect', eventId, now);

describe('finance.collect through a door shift', () => {
	it('allows a confirmed door volunteer to collect for their show, during the shift', async () => {
		signup('door-tonight', 'vol', 'confirmed');
		expect(await collect('vol', 'tonight', during)).toBe(true);
		expect(await collect('vol', 'tonight', shiftStart)).toBe(true);
		expect(await collect('vol', 'tonight', shiftEnd)).toBe(true);
	});

	it('denies the same volunteer at another show', async () => {
		signup('door-tonight', 'vol', 'confirmed');
		expect(await collect('vol', 'other', during)).toBe(false);
	});

	it('denies outside the shift: before it starts and once it has ended', async () => {
		signup('door-tonight', 'vol', 'confirmed');
		expect(await collect('vol', 'tonight', new Date(shiftStart.getTime() - 60_000))).toBe(false);
		expect(await collect('vol', 'tonight', new Date(shiftEnd.getTime() + 60_000))).toBe(false);
	});

	it('denies a claimed signup that staff have not confirmed', async () => {
		signup('door-tonight', 'vol', 'claimed');
		expect(await collect('vol', 'tonight', during)).toBe(false);
	});

	it("denies a member who is not on the show's crew", async () => {
		signup('door-tonight', 'vol', 'confirmed');
		expect(await collect('someone-else', 'tonight', during)).toBe(false);
	});

	it('denies crew whose role does not carry the grant', async () => {
		doorShift('merch-tonight', 'tonight', []);
		signup('merch-tonight', 'merch', 'confirmed');
		expect(await collect('merch', 'tonight', during)).toBe(false);
	});
});
