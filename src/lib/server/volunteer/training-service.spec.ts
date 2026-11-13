import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * Training on a shift (#2720), against a real SQLite: who may set a
 * supervisor, the same-shift and not-self integrity rules, and the supervised
 * shifts a grant can cite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));

const svc = await import('./training-service');
const { grantCertification, MemberCertificationValidationError } =
	await import('./member-certification-service');
const { user } = await import('#lib/server/db/schema/authentication.js');
const {
	memberCertification,
	volunteerCertification,
	volunteerRole,
	volunteerRoleCertification,
	volunteerShift,
	volunteerSignup,
	workOrder
} = await import('#lib/server/db/schema/volunteer.js');

const STAFF = 'usr-staff';
const SUPERVISOR = 'usr-sup';
const TRAINEE = 'usr-trainee';
const OTHER = 'usr-other';
const CERT = 'cert-sound';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeEach(async () => {
	sqlite.exec('PRAGMA foreign_keys = OFF');
	for (const t of [
		'member_certification',
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'volunteer_role_certification',
		'volunteer_certification',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.exec('PRAGMA foreign_keys = ON');

	await testDb.insert(user).values(
		[STAFF, SUPERVISOR, TRAINEE, OTHER].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: false
		})) as never
	);
	await testDb.insert(volunteerRole).values({ id: 'role', name: 'Sound', isActive: true } as never);
	await testDb.insert(volunteerCertification).values({ id: CERT, name: 'Sound desk' } as never);
	await testDb
		.insert(volunteerRoleCertification)
		.values({ volunteerRoleId: 'role', certificationId: CERT });
	await testDb.insert(workOrder).values({ id: 'task', volunteerRoleId: 'role' } as never);
	for (const id of ['shift-a', 'shift-b']) {
		await testDb.insert(volunteerShift).values({
			id,
			workOrderId: 'task',
			startsAt: daysAgo(3),
			endsAt: daysAgo(2.9),
			capacity: 4
		} as never);
	}
	await testDb.insert(volunteerSignup).values([
		{ id: 'sup', shiftId: 'shift-a', userId: SUPERVISOR, status: 'completed' },
		{ id: 'tr', shiftId: 'shift-a', userId: TRAINEE, status: 'completed' },
		{ id: 'oth', shiftId: 'shift-a', userId: OTHER, status: 'completed' },
		{ id: 'elsewhere', shiftId: 'shift-b', userId: OTHER, status: 'completed' }
	] as never);
});

async function supervisorOf(id: string) {
	const [row] = await testDb
		.select({ s: volunteerSignup.supervisingSignupId })
		.from(volunteerSignup)
		.where(eq(volunteerSignup.id, id));
	return row.s;
}

const set = (supervisingSignupId: string | null, actorUserId: string, actorIsStaff = false) =>
	svc.setSupervisingSignup({ signupId: 'tr', supervisingSignupId, actorUserId, actorIsStaff });

describe('setSupervisingSignup', () => {
	it('lets the supervisor name their own signup, and clear it', async () => {
		await set('sup', SUPERVISOR);
		expect(await supervisorOf('tr')).toBe('sup');

		await set(null, SUPERVISOR);
		expect(await supervisorOf('tr')).toBeNull();
	});

	it('lets staff set and clear anyone', async () => {
		await set('oth', STAFF, true);
		expect(await supervisorOf('tr')).toBe('oth');
		await set(null, STAFF, true);
		expect(await supervisorOf('tr')).toBeNull();
	});

	it('refuses a supervisor on a different shift, even from staff', async () => {
		await expect(set('elsewhere', STAFF, true)).rejects.toBeInstanceOf(svc.TrainingValidationError);
		expect(await supervisorOf('tr')).toBeNull();
	});

	it('refuses a member supervising themselves', async () => {
		await expect(set('tr', STAFF, true)).rejects.toBeInstanceOf(svc.TrainingValidationError);
	});

	it('refuses a member who is neither staff nor the supervisor', async () => {
		await expect(set('sup', OTHER)).rejects.toBeInstanceOf(svc.TrainingNotAllowedError);
		await set('sup', STAFF, true);
		await expect(set(null, OTHER)).rejects.toBeInstanceOf(svc.TrainingNotAllowedError);
		// Nor can another supervisor take the trainee over.
		await expect(set('oth', OTHER)).rejects.toBeInstanceOf(svc.TrainingNotAllowedError);
		expect(await supervisorOf('tr')).toBe('sup');
	});
});

describe('training shifts at grant', () => {
	it('lists completed supervised shifts with the clearances their role asks for', async () => {
		expect(await svc.listTrainingShifts(TRAINEE)).toEqual([]);
		await set('sup', SUPERVISOR);

		const shifts = await svc.listTrainingShifts(TRAINEE);
		expect(shifts).toHaveLength(1);
		expect(shifts[0]).toMatchObject({
			signupId: 'tr',
			supervisorName: SUPERVISOR,
			certificationIds: [CERT]
		});
	});

	it('leaves out a supervised shift that has not completed', async () => {
		await set('sup', SUPERVISOR);
		await testDb
			.update(volunteerSignup)
			.set({ status: 'confirmed' })
			.where(eq(volunteerSignup.id, 'tr'));
		expect(await svc.listTrainingShifts(TRAINEE)).toEqual([]);
	});

	it('records the cited shift on the grant, and refuses one that is not evidence', async () => {
		await set('sup', SUPERVISOR);
		const base = { userId: TRAINEE, certificationId: CERT, grantedByUserId: STAFF };

		await expect(
			grantCertification({ ...base, grantedOn: '2020-01-01', trainingSignupId: 'oth' })
		).rejects.toBeInstanceOf(MemberCertificationValidationError);

		const row = await grantCertification({
			...base,
			grantedOn: '2020-01-01',
			trainingSignupId: 'tr'
		});
		const [stored] = await testDb
			.select({ t: memberCertification.trainingSignupId })
			.from(memberCertification)
			.where(eq(memberCertification.id, row.id));
		expect(stored.t).toBe('tr');
	});
});

describe('listCrewMates', () => {
	it('lists the others on the shift and marks whose supervisor is whom', async () => {
		await set('oth', STAFF, true);
		const crew = await svc.listCrewMates('sup', 'shift-a');
		expect(crew.map((c) => c.signupId).sort()).toEqual(['oth', 'tr']);
		expect(crew.find((c) => c.signupId === 'tr')).toMatchObject({
			trainedUnderMe: false,
			trainedUnderOther: true
		});
	});
});
