import { describe, it, expect } from 'vitest';
import { mockUser, mockRole, mockStandardRoles } from './test-factory';

describe('mockUser', () => {
	it('generates a user with all required fields', () => {
		const user = mockUser();

		expect(user.id).toBeTruthy();
		expect(user.name).toBeTruthy();
		expect(user.email).toContain('@');
		expect(user.emailVerified).toBe(true);
		expect(user.createdAt).toBeInstanceOf(Date);
		expect(user.updatedAt).toBeInstanceOf(Date);
	});

	it('sets nullable corvmc fields to null by default', () => {
		const user = mockUser();

		expect(user.deletedAt).toBeNull();
		expect(user.stripeId).toBeNull();
		expect(user.pmType).toBeNull();
		expect(user.pmLastFour).toBeNull();
		expect(user.settings).toBeNull();
	});

	it('applies overrides', () => {
		const user = mockUser({
			name: 'Devon Cash',
			email: 'devon@corvmc.org',
			pronouns: 'he/him'
		});

		expect(user.name).toBe('Devon Cash');
		expect(user.email).toBe('devon@corvmc.org');
		expect(user.pronouns).toBe('he/him');
		// Non-overridden fields still generated
		expect(user.id).toBeTruthy();
	});

	it('can simulate a soft-deleted user', () => {
		const user = mockUser({ deletedAt: new Date('2026-01-15') });

		expect(user.deletedAt).toEqual(new Date('2026-01-15'));
	});
});

describe('mockRole', () => {
	it('generates a role with the given name', () => {
		const role = mockRole('admin');

		expect(role.name).toBe('admin');
		expect(role.guardName).toBe('web');
		expect(role.createdAt).toBeInstanceOf(Date);
	});

	it('accepts an explicit id', () => {
		const role = mockRole('staff', 7);

		expect(role.id).toBe(7);
		expect(role.name).toBe('staff');
	});
});

describe('mockStandardRoles', () => {
	it('generates all four app roles', () => {
		const roles = mockStandardRoles();

		expect(roles).toHaveLength(4);
		expect(roles.map((r) => r.name)).toEqual(['admin', 'staff', 'member', 'volunteer']);
	});

	it('assigns sequential IDs starting at 1', () => {
		const roles = mockStandardRoles();

		expect(roles.map((r) => r.id)).toEqual([1, 2, 3, 4]);
	});
});
