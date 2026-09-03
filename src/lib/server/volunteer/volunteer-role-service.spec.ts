import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — the chainable db proxy from equipment-service.spec.ts
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
/** What `.set()` was actually handed, so a write can be asserted rather than inferred. */
let updateSets: Record<string, unknown>[] = [];
let deleteResult: unknown[] = [];
let insertError: Error | null = null;

function chainable(result?: unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result !== undefined) return resolve(result);
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn(() =>
					insertError ? Promise.reject(insertError) : Promise.resolve(insertResult)
				)
			}))
		})),
		update: vi.fn(() => ({
			set: vi.fn((values: Record<string, unknown>) => {
				updateSets.push(values);
				return {
					where: vi.fn(() => ({
						returning: vi.fn(() => Promise.resolve(updateResult))
					}))
				};
			})
		})),
		delete: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve(deleteResult))
			}))
		}))
	}
}));

import {
	createVolunteerRole,
	updateVolunteerRole,
	archiveVolunteerRole,
	restoreVolunteerRole,
	deleteVolunteerRole,
	VolunteerRoleNotFoundError,
	VolunteerRoleNameTakenError,
	VolunteerRoleInUseError,
	VolunteerRoleValidationError
} from './volunteer-role-service';
import {
	VOLUNTEER_ROLE_DESCRIPTION_MAX,
	VOLUNTEER_ROLE_NAME_MAX,
	VOLUNTEER_SHIFT_MAX_CAPACITY
} from '$lib/config';

const ROLE = { id: 'role-1', name: 'Front Desk', isActive: true, displayOrder: 0 };

describe('VolunteerRoleService', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		selectResult = [];
		selectResultQueue = [];
		insertResult = [ROLE];
		updateResult = [ROLE];
		deleteResult = [ROLE];
		insertError = null;
	});

	describe('createVolunteerRole', () => {
		it('creates a role with a trimmed name', async () => {
			const role = await createVolunteerRole({ name: '  Front Desk  ' });
			expect(role).toEqual(ROLE);
		});

		it('rejects a blank name', async () => {
			await expect(createVolunteerRole({ name: '   ' })).rejects.toThrow(
				VolunteerRoleValidationError
			);
		});

		it('rejects a name over the length limit', async () => {
			await expect(
				createVolunteerRole({ name: 'x'.repeat(VOLUNTEER_ROLE_NAME_MAX + 1) })
			).rejects.toThrow(VolunteerRoleValidationError);
		});

		it('rejects a description over the length limit', async () => {
			await expect(
				createVolunteerRole({
					name: 'Front Desk',
					description: 'x'.repeat(VOLUNTEER_ROLE_DESCRIPTION_MAX + 1)
				})
			).rejects.toThrow(VolunteerRoleValidationError);
		});

		it('rejects a negative display order', async () => {
			await expect(createVolunteerRole({ name: 'Front Desk', displayOrder: -1 })).rejects.toThrow(
				VolunteerRoleValidationError
			);
		});

		// Both shift defaults are optional and clearable, so `null` has to survive
		// validation — it is how "this role has no usual shape" is expressed.
		it('accepts null shift defaults', async () => {
			await expect(
				createVolunteerRole({
					name: 'Front Desk',
					defaultDurationMinutes: null,
					defaultCapacity: null
				})
			).resolves.toBeDefined();
		});

		it('rejects a zero or fractional shift length', async () => {
			await expect(
				createVolunteerRole({ name: 'Front Desk', defaultDurationMinutes: 0 })
			).rejects.toThrow(VolunteerRoleValidationError);
			await expect(
				createVolunteerRole({ name: 'Front Desk', defaultDurationMinutes: 90.5 })
			).rejects.toThrow(VolunteerRoleValidationError);
		});

		it('rejects a shift length longer than a day', async () => {
			await expect(
				createVolunteerRole({ name: 'Front Desk', defaultDurationMinutes: 1441 })
			).rejects.toThrow(VolunteerRoleValidationError);
		});

		// A default that could never be submitted as an actual shift is a trap, so
		// the ceiling here is the one the shift form and the CHECK already enforce.
		it('rejects a default capacity above the shift ceiling', async () => {
			await expect(
				createVolunteerRole({
					name: 'Front Desk',
					defaultCapacity: VOLUNTEER_SHIFT_MAX_CAPACITY + 1
				})
			).rejects.toThrow(VolunteerRoleValidationError);
			await expect(createVolunteerRole({ name: 'Front Desk', defaultCapacity: 0 })).rejects.toThrow(
				VolunteerRoleValidationError
			);
		});

		// The name is UNIQUE in SQLite, which surfaces as a driver error rather
		// than something typed. Members pick roles by name, so a duplicate has to
		// come back as a clear conflict, not a 500.
		it('surfaces a duplicate name as VolunteerRoleNameTakenError', async () => {
			insertError = new Error('D1_ERROR: UNIQUE constraint failed: volunteer_role.name');
			await expect(createVolunteerRole({ name: 'Front Desk' })).rejects.toThrow(
				VolunteerRoleNameTakenError
			);
		});
	});

	describe('updateVolunteerRole', () => {
		it('throws when the role is gone', async () => {
			updateResult = [];
			await expect(updateVolunteerRole('missing', { name: 'Nope' })).rejects.toThrow(
				VolunteerRoleNotFoundError
			);
		});

		it('normalizes an empty description to null rather than an empty string', async () => {
			updateResult = [{ ...ROLE, description: null }];
			const role = await updateVolunteerRole(ROLE.id, { description: '   ' });
			expect(role.description).toBeNull();
		});
	});

	describe('archive and restore', () => {
		it('archives by flipping isActive, keeping the row resolvable', async () => {
			updateResult = [{ ...ROLE, isActive: false }];
			const role = await archiveVolunteerRole(ROLE.id);
			expect(role.isActive).toBe(false);
		});

		it('restores an archived role', async () => {
			updateResult = [{ ...ROLE, isActive: true }];
			const role = await restoreVolunteerRole(ROLE.id);
			expect(role.isActive).toBe(true);
		});

		it('throws when archiving a role that is gone', async () => {
			updateResult = [];
			await expect(archiveVolunteerRole('missing')).rejects.toThrow(VolunteerRoleNotFoundError);
		});
	});

	describe('deleteVolunteerRole', () => {
		// Deleting a role with history would silently rewrite past reports — the
		// FK is RESTRICT, and this guard is the friendly version of that failure.
		it('refuses to delete a role that has hour logs', async () => {
			selectResult = [{ count: 4 }];
			await expect(deleteVolunteerRole(ROLE.id)).rejects.toThrow(VolunteerRoleInUseError);
		});

		it('names the archive alternative in the error message', async () => {
			selectResult = [{ count: 4 }];
			await expect(deleteVolunteerRole(ROLE.id)).rejects.toThrow(/[Aa]rchive/);
		});

		it('deletes a role nothing was logged against', async () => {
			selectResult = [{ count: 0 }];
			const role = await deleteVolunteerRole(ROLE.id);
			expect(role).toEqual(ROLE);
		});

		it('throws when the role is gone', async () => {
			selectResult = [{ count: 0 }];
			deleteResult = [];
			await expect(deleteVolunteerRole('missing')).rejects.toThrow(VolunteerRoleNotFoundError);
		});
	});
});

// ---------------------------------------------------------------------------
// The specialized-skill split
// ---------------------------------------------------------------------------

describe('specialized skill', () => {
	beforeEach(() => {
		updateSets = [];
		updateResult = [ROLE];
	});

	it('keeps the flag and the rate together on an update', async () => {
		await updateVolunteerRole(ROLE.id, { isSpecializedSkill: true, marketRateCents: 6500 });

		expect(updateSets.at(-1)).toMatchObject({
			isSpecializedSkill: true,
			marketRateCents: 6500
		});
	});

	it('allows a specialized role with no rate — that is the gap, not an error', async () => {
		await updateVolunteerRole(ROLE.id, { isSpecializedSkill: true, marketRateCents: null });

		expect(updateSets.at(-1)).toMatchObject({
			isSpecializedSkill: true,
			marketRateCents: null
		});
	});

	it('clears the rate when the flag comes off', async () => {
		// A rate on a role that is not a specialized skill is not a value waiting
		// to be used — it is a claim nobody is making, and it would reappear the
		// moment somebody ticked the box again months later.
		await updateVolunteerRole(ROLE.id, { isSpecializedSkill: false, marketRateCents: 6500 });

		expect(updateSets.at(-1)).toMatchObject({
			isSpecializedSkill: false,
			marketRateCents: null
		});
	});

	it('refuses a negative or fractional rate', async () => {
		await expect(updateVolunteerRole(ROLE.id, { marketRateCents: -1 })).rejects.toThrow(
			VolunteerRoleValidationError
		);
		await expect(updateVolunteerRole(ROLE.id, { marketRateCents: 65.5 })).rejects.toThrow(
			VolunteerRoleValidationError
		);
	});
});
