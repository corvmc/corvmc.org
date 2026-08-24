import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { role, modelHasRole } from '$lib/server/db/schema/authorization';
import { eq, and, getColumnTable, getTableName, sql, inArray, type AnyColumn } from 'drizzle-orm';
import { user } from '$lib/server/db/schema/authentication';

/**
 * Correlated subquery returning the highest-priority role name for a given user ID column.
 * Priority: admin > staff > sustaining > member (fallback).
 * Use inside a drizzle `.select()` as a computed column, e.g. `primaryRole: primaryRoleFor(user.id)`.
 *
 * The outer reference is qualified manually: drizzle renders an interpolated Column
 * unqualified in single-table select lists, and inside this subquery the bare name
 * would bind to `roles.id`, so the predicate could never match a user id. Mirrors
 * `isSustainingMemberSql`.
 */
export function primaryRoleFor(userIdCol: AnyColumn) {
	const outerRef = sql.raw(`"${getTableName(getColumnTable(userIdCol))}"."${userIdCol.name}"`);
	return sql<string>`(
		select r.name from roles r
		inner join model_has_roles mhr on mhr.role_id = r.id
		where mhr.user_id = ${outerRef}
		order by case r.name
			when 'admin' then 0
			when 'staff' then 1
			when 'sustaining' then 2
			when 'member' then 3
			else 4
		end
		limit 1
	)`;
}

/**
 * Check whether a user has a specific role.
 */
export async function hasRole(userId: string, roleName: string): Promise<boolean> {
	const result = await db
		.select({ roleId: role.id })
		.from(role)
		.innerJoin(modelHasRole, eq(modelHasRole.roleId, role.id))
		.where(and(eq(role.name, roleName), eq(modelHasRole.userId, userId)))
		.limit(1);

	return result.length > 0;
}

/**
 * Check whether a user has any of the given roles.
 */
export async function hasAnyRole(userId: string, roleNames: string[]): Promise<boolean> {
	const result = await db
		.select({ roleId: role.id })
		.from(role)
		.innerJoin(modelHasRole, eq(modelHasRole.roleId, role.id))
		.where(and(inArray(role.name, roleNames), eq(modelHasRole.userId, userId)))
		.limit(1);
	return result.length > 0;
}

/**
 * Assert the current request is from an authenticated user with a staff or admin role.
 * Throws 401/403 via SvelteKit error() if not.
 * Returns the authenticated user for convenience.
 */
export async function requireStaff() {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');
	const allowed = await hasAnyRole(locals.user.id, ['admin', 'staff']);
	if (!allowed) throw error(403, 'Staff access required');
	return locals.user;
}

/**
 * Assert the current request is from an authenticated user.
 * Throws 401 via SvelteKit error() if not.
 * Returns the authenticated user for convenience.
 */
export function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');
	return locals.user;
}

/** @deprecated Use requireUser() instead */
export const requireMember = requireUser;

/**
 * Get all role names for a user.
 */
export async function getUserRoles(userId: string): Promise<string[]> {
	const rows = await db
		.select({ name: role.name })
		.from(role)
		.innerJoin(modelHasRole, eq(modelHasRole.roleId, role.id))
		.where(eq(modelHasRole.userId, userId));

	return rows.map((r) => r.name);
}

/**
 * Assign a role to a user. No-op if already assigned.
 */
export async function assignRole(userId: string, roleName: string): Promise<void> {
	const [found] = await db
		.select({ id: role.id })
		.from(role)
		.where(eq(role.name, roleName))
		.limit(1);

	if (!found) return;

	await db.insert(modelHasRole).values({ roleId: found.id, userId }).onConflictDoNothing();
}

/**
 * Remove a role from a user. No-op if not assigned.
 */
export async function removeRole(userId: string, roleName: string): Promise<void> {
	const [found] = await db
		.select({ id: role.id })
		.from(role)
		.where(eq(role.name, roleName))
		.limit(1);

	if (!found) return;

	await db
		.delete(modelHasRole)
		.where(and(eq(modelHasRole.roleId, found.id), eq(modelHasRole.userId, userId)));
}

/**
 * Check if a user is staff/admin. Returns true/false without throwing.
 */
export async function isStaff(userId: string): Promise<boolean> {
	return hasAnyRole(userId, ['admin', 'staff']);
}

/**
 * Require that the caller is either staff or the owner of the resource.
 * Throws 401/403 via SvelteKit error() if neither.
 * Returns the resolved role ('staff' | 'owner') for the caller.
 */
export async function requireStaffOrOwner(
	userId: string | undefined,
	ownerId: string
): Promise<'staff' | 'owner'> {
	if (!userId) throw error(401, 'Not authenticated');
	if (userId === ownerId) return 'owner';
	const staff = await isStaff(userId);
	if (staff) return 'staff';
	throw error(403, 'Not authorized');
}

/**
 * Require that the caller is staff. For use in API route handlers
 * where locals.user is already available (not command/query context).
 */
export async function requireStaffRole(userId: string | undefined): Promise<void> {
	if (!userId) throw error(401, 'Not authenticated');
	const staff = await isStaff(userId);
	if (!staff) throw error(403, 'Staff access required');
}

/**
 * List all users with admin or staff roles.
 */
export async function listStaffUsers(): Promise<
	Array<{ id: string; name: string; email: string }>
> {
	const rows = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.innerJoin(modelHasRole, eq(modelHasRole.userId, user.id))
		.innerJoin(role, eq(role.id, modelHasRole.roleId))
		.where(inArray(role.name, ['admin', 'staff']));

	const seen = new Set<string>();
	return rows.filter((r) => {
		if (seen.has(r.id)) return false;
		seen.add(r.id);
		return true;
	});
}

/**
 * Find a staff or admin user by email address, or null.
 *
 * Used to tell a staff member's emailed reply apart from a contact's, so the
 * inbox can relay theirs instead of filing it as inbound. Matched
 * case-insensitively: SQLite compares TEXT with `=` case-sensitively, and no
 * mail client normalises the envelope From, so a plain `eq` would silently
 * treat `Ada@corvmc.org` as a stranger.
 */
export async function findStaffUserByEmail(
	email: string
): Promise<{ id: string; name: string; email: string } | null> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return null;

	const [row] = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.innerJoin(modelHasRole, eq(modelHasRole.userId, user.id))
		.innerJoin(role, eq(role.id, modelHasRole.roleId))
		.where(and(eq(sql`lower(${user.email})`, normalized), inArray(role.name, ['admin', 'staff'])))
		.limit(1);

	return row ?? null;
}
