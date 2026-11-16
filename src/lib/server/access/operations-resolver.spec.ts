import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Every read of who holds a position sees an Operations seat (#2992), against
 * real SQLite: `admin` from its role row, every job from a seat, nothing from
 * a job name left in `model_has_roles` or an inactive roster row.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/server', () => ({ getRequestEvent: () => ({ locals: {} }) }));

const {
	positionsFor,
	isElevated,
	userHasCapability,
	listUsersWithCapability,
	findStaffUserByEmail,
	topPositionFor
} = await import('#lib/server/authorization.js');
const { user } = await import('#lib/server/db/schema/authentication.js');
const { seatSql } = await import('#lib/server/testing/operations-seat.js');

beforeAll(() => {
	sqlite.exec(`insert into user (id, name, email) values
		('u-admin', 'Ada', 'ada@example.com'),
		('u-treas', 'Tia', 'Tia@Example.com'),
		('u-chair', 'Cy', 'cy@example.com'),
		('u-left', 'Lu', 'lu@example.com'),
		('u-stale', 'Sy', 'sy@example.com')`);
	sqlite.exec(`insert into roles (id, name) values (1, 'admin'), (2, 'treasurer')`);
	sqlite.exec(
		`insert into model_has_roles (role_id, user_id) values (1, 'u-admin'), (2, 'u-stale')`
	);
	sqlite.exec(
		seatSql('u-treas', 'treasurer') +
			seatSql('u-treas', 'auditor') +
			seatSql('u-chair', 'operations_chair') +
			seatSql('u-left', 'treasurer')
	);
	sqlite.exec(`update group_member set status = 'pending' where user_id = 'u-left'`);
});

describe('positions held through Operations', () => {
	it('reads admin from its role row and jobs from seats', async () => {
		expect(await positionsFor('u-admin')).toEqual(['admin']);
		expect(await positionsFor('u-treas')).toEqual(['treasurer', 'auditor']);
		expect(await positionsFor('u-chair')).toEqual(['operations_chair']);
	});

	it('grants nothing from a job role row or an inactive seat', async () => {
		expect(await positionsFor('u-stale')).toEqual([]);
		expect(await positionsFor('u-left')).toEqual([]);
		expect(await isElevated('u-left')).toBe(false);
	});

	it('gives the Operations chair committee oversight', async () => {
		expect(await userHasCapability('u-chair', 'committee.manage')).toBe(true);
		expect(await userHasCapability('u-chair', 'finance.refund')).toBe(false);
	});

	it('lists seat holders as capability holders', async () => {
		const ids = (await listUsersWithCapability('finance.refund')).map((u) => u.id).sort();
		expect(ids).toEqual(['u-admin', 'u-treas']);
	});

	it('recognises a seat holder’s mail as staff mail', async () => {
		expect(await findStaffUserByEmail('tia@example.com')).toMatchObject({ id: 'u-treas' });
		expect(await findStaffUserByEmail('sy@example.com')).toBeNull();
	});

	it('badges by display precedence across both sources', async () => {
		const rows = await testDb
			.select({ id: user.id, role: topPositionFor(user.id) })
			.from(user)
			.orderBy(user.id);
		expect(rows).toEqual([
			{ id: 'u-admin', role: 'admin' },
			{ id: 'u-chair', role: 'operations_chair' },
			{ id: 'u-left', role: null },
			{ id: 'u-stale', role: null },
			{ id: 'u-treas', role: 'treasurer' }
		]);
	});
});
