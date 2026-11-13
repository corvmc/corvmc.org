import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A double claim that loses the race, against a real SQLite behind the D1 driver. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry: vi.fn() }));
vi.mock('./member-certification-service', () => ({ missingRequirements: async () => [] }));
vi.mock('./volunteer-profile-service', async (importOriginal) => ({
	...(await importOriginal<object>()),
	requireActiveVolunteer: async () => ({ id: 'vp-1', status: 'active' })
}));

const startsAt = new Date(Date.now() + 86_400_000);
const endsAt = new Date(startsAt.getTime() + 3_600_000);
const shift = {
	id: 'shift-1',
	capacity: 3,
	startsAt,
	endsAt,
	volunteerRoleId: 'role-1',
	cancelledAt: null,
	taskCancelledAt: null,
	taskResolvedAt: null
};
vi.mock('./work-order-service', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getShiftById: async () => shift
}));

const { claimShift } = await import('./volunteer-signup-service');

beforeEach(() => {
	sqlite.exec('delete from volunteer_signup');
	sqlite.exec('delete from volunteer_shift');
	sqlite
		.prepare(
			`insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity)
			 values ('shift-1', 'wo-1', ?, ?, 3)`
		)
		.run(Math.floor(startsAt.getTime() / 1000), Math.floor(endsAt.getTime() / 1000));
});

describe('claimShift', () => {
	it('returns one sign-up to both tabs when a member claims twice at once', async () => {
		// Same awaits in the same order, so both pass the existing-row check before either writes.
		const [a, b] = await Promise.all([
			claimShift('shift-1', 'user-1'),
			claimShift('shift-1', 'user-1')
		]);
		expect(b.id).toBe(a.id);
		expect(sqlite.prepare('select count(*) as n from volunteer_signup').get()).toEqual({ n: 1 });
	});
});
