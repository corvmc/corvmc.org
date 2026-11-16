/**
 * Test data factory using zod4-mock.
 *
 * Usage:
 *   import { factory } from '#lib/server/db/test-factory.js';
 *   const users = factory.generate(z.array(UserSchema).min(3));
 *   const roles = factory.generate(z.array(RoleSchema).min(2));
 */
import { z } from 'zod';
import { createWorld } from 'zod4-mock';
import { UserSchema, RoleSchema, PermissionSchema, UserHasRoleSchema } from './test-schemas';

const STAFF_ROLES = ['admin', 'staff', 'member', 'volunteer'] as const;

export const factory = createWorld({ seed: 42 })
	.withSchema(UserSchema, {
		matchers: {
			emailVerified: () => true,
			image: () => null,
			settings: () => null,
			stripeId: () => null,
			pmType: () => null,
			pmLastFour: () => null,
			deletedAt: () => null
		}
	})
	.withSchema(RoleSchema, {
		matchers: {
			name: (ctx) => STAFF_ROLES[ctx.prng.int(0, STAFF_ROLES.length - 1)],
			guardName: () => 'web' as const
		}
	})
	.withSchema(PermissionSchema, {
		matchers: {
			guardName: () => 'web' as const
		}
	})
	.withSchema(UserHasRoleSchema, {
		relations: { user: UserSchema, role: RoleSchema },
		matchers: {
			userId: (ctx) => ctx.related('user').id,
			roleId: (ctx) => ctx.related('role').id
		}
	});

/**
 * Generate a single user with defaults.
 */
export function mockUser(overrides?: Partial<z.infer<typeof UserSchema>>) {
	const generated = factory.generate(UserSchema);
	return overrides ? { ...generated, ...overrides } : generated;
}

/**
 * Generate a role with a specific name.
 */
export function mockRole(name: string, id?: number) {
	return {
		...factory.generate(RoleSchema),
		name,
		...(id !== undefined ? { id } : {})
	};
}

/**
 * Generate a set of the standard roles used in the app.
 */
export function mockStandardRoles() {
	return STAFF_ROLES.map((name, i) => mockRole(name, i + 1));
}
