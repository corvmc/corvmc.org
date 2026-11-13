import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Duplicate writes against a real SQLite behind the D1 driver, as production reports them. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedD1 } = await import('#lib/server/testing/migrated-d1.js');
	return migratedD1();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { createCertification, updateCertification, CertificationNameTakenError } =
	await import('./volunteer-certification-service');
const { createVolunteerRole, updateVolunteerRole, VolunteerRoleNameTakenError } =
	await import('./volunteer-role-service');
const { submitFeedback, FeedbackAlreadySubmittedError } =
	await import('./volunteer-feedback-service');

beforeEach(() => {
	for (const table of [
		'volunteer_shift_feedback',
		'volunteer_signup',
		'volunteer_certification',
		'volunteer_role'
	])
		sqlite.exec(`delete from ${table}`);
});

describe('certification names', () => {
	it('refuses a second certification with the same name', async () => {
		await createCertification({ name: 'Food handler' });
		await expect(createCertification({ name: 'Food handler' })).rejects.toBeInstanceOf(
			CertificationNameTakenError
		);
	});

	it('refuses renaming one onto another', async () => {
		await createCertification({ name: 'Food handler' });
		const other = await createCertification({ name: 'First aid' });
		await expect(updateCertification(other.id, { name: 'Food handler' })).rejects.toBeInstanceOf(
			CertificationNameTakenError
		);
	});
});

describe('role names', () => {
	it('refuses a second role with the same name', async () => {
		await createVolunteerRole({ name: 'Door' });
		await expect(createVolunteerRole({ name: 'Door' })).rejects.toBeInstanceOf(
			VolunteerRoleNameTakenError
		);
	});

	it('refuses renaming one onto another', async () => {
		await createVolunteerRole({ name: 'Door' });
		const other = await createVolunteerRole({ name: 'Sound' });
		await expect(updateVolunteerRole(other.id, { name: 'Door' })).rejects.toBeInstanceOf(
			VolunteerRoleNameTakenError
		);
	});
});

describe('shift feedback', () => {
	it('refuses a second answer for the same sign-up', async () => {
		sqlite.exec(
			`insert into volunteer_signup (id, shift_id, user_id, status)
			 values ('signup-1', 'shift-1', 'user-1', 'completed')`
		);
		const answer = { signupId: 'signup-1', userId: 'user-1', rating: 4, wasSetUp: true };
		await submitFeedback(answer);
		await expect(submitFeedback(answer)).rejects.toBeInstanceOf(FeedbackAlreadySubmittedError);
	});
});
