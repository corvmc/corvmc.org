import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Clearance grants, revocations and orientation waivers each leave an audit row (#2818). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'staff-1', name: 'Sam Staff', email: 'staff@example.com' } }
	})
}));

const { grantCertification, revokeCertification } = await import('./member-certification-service');
const { waiveOrientation } = await import('./orientation-service');
const { listAuditEntriesForSubject } = await import('#lib/server/audit/audit-service.js');
const { volunteerCertification } = await import('#lib/server/db/schema/volunteer.js');

const history = async () =>
	(await listAuditEntriesForSubject({ type: 'user', id: 'member-1' })).entries;

beforeEach(async () => {
	sqlite.exec('delete from audit_log');
	sqlite.exec('delete from member_certification');
	sqlite.exec('delete from member_orientation');
	sqlite.exec('delete from volunteer_certification');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('member-1', 'Ellis Park', 'ellis@example.com', 1),
			('staff-1', 'Sam Staff', 'staff@example.com', 1)`
	);
	await testDb
		.insert(volunteerCertification)
		.values({ id: 'sound', name: 'Sound Desk Cleared', validityMonths: 12 });
});

describe('clearance audit', () => {
	it('records a grant with its name and expiry', async () => {
		await grantCertification({
			userId: 'member-1',
			certificationId: 'sound',
			grantedOn: '2026-01-31',
			grantedByUserId: 'staff-1'
		});

		const [row] = await history();
		expect(row).toMatchObject({
			action: 'clearance.granted',
			actorUserId: 'staff-1',
			subjectLabel: 'Ellis Park',
			details: { certificationName: 'Sound Desk Cleared', grantedOn: '2026-01-31' }
		});
		expect((row.details as { expiresOn: string }).expiresOn).toBe('2027-01-31');
	});

	it('records a revocation with its reason', async () => {
		const held = await grantCertification({
			userId: 'member-1',
			certificationId: 'sound',
			grantedOn: '2026-01-31',
			grantedByUserId: 'staff-1'
		});
		await revokeCertification(held.id, 'staff-1', 'Left the crew');

		expect((await history()).map((e) => e.action)).toContain('clearance.revoked');
	});

	it('records an orientation waiver', async () => {
		await waiveOrientation('member-1', {
			waivedByUserId: 'staff-1',
			reason: 'Played here for years'
		});

		expect(await history()).toEqual([
			expect.objectContaining({
				action: 'orientation.waived',
				details: { reason: 'Played here for years' }
			})
		]);
	});
});
