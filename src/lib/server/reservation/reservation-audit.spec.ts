import { describe, it, expect, beforeEach, vi } from 'vitest';

/** A comp against a real SQLite: the waiver and its audit row land together (#2817). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 1 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'staff-1', name: 'Sam Staff', email: 'staff@example.com' } }
	})
}));

const { comp } = await import('./reservation-service');
const { listAuditEntriesForSubject } = await import('#lib/server/audit/audit-service.js');
const { reservation } = await import('#lib/server/db/schema/reservation.js');

beforeEach(async () => {
	sqlite.exec('delete from audit_log');
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('member-1', 'Dez Halloran', 'dez@example.com', 1)`
	);
	await testDb.insert(reservation).values({
		id: 'res-1',
		bookerType: 'user',
		bookerId: 'member-1',
		createdByUserId: 'member-1',
		status: 'confirmed',
		startsAt: new Date('2026-06-15T19:00:00Z'),
		endsAt: new Date('2026-06-15T21:00:00Z'),
		cashDueCents: 3000,
		creditsUsed: 1
	});
});

describe('comp', () => {
	it('records who waived what, on the member who booked', async () => {
		await comp('res-1');

		const { entries } = await listAuditEntriesForSubject({ type: 'user', id: 'member-1' });
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			action: 'reservation.comped',
			actorUserId: 'staff-1',
			subjectLabel: 'Dez Halloran',
			details: { reservationId: 'res-1', waivedCents: 3000, date: expect.any(String) }
		});
	});
});
