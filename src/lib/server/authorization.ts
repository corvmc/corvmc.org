import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { createAccessControl, role as buildRole } from 'better-auth/plugins/access';
import { db } from '$lib/server/db';
import { role, modelHasRole } from '$lib/server/db/schema/authorization';
import { eq, and, getColumnTable, getTableName, sql, inArray, type AnyColumn } from 'drizzle-orm';
import { user } from '$lib/server/db/schema/authentication';
import {
	capabilities,
	positions,
	positionOrder,
	positionsGranting,
	type Capability,
	type Position
} from '$lib/config';

// ---------------------------------------------------------------------------
// Capabilities
//
// Guards name a capability; the matrix in `$lib/config` says who holds it.
// See docs/specs/admin-vs-staff-spec.md.
//
// The access controller is built HERE rather than in config.ts because
// `createAccessControl` is a better-auth import and config.ts is imported by
// 88 `.svelte` files — building it there would ship better-auth to the
// browser. `better-auth/plugins/access` is a standalone subpath export: it
// touches no plugin, no auth instance and no table, and `authorize()` is pure
// and synchronous, returning `{ success, error }` rather than a boolean, which
// is why the guards below wrap it.
// ---------------------------------------------------------------------------

const ac = createAccessControl(capabilities);

/**
 * One better-auth Role per position, built once at module scope.
 *
 * Only `.statements` is read (by `authorizerFor`, which merges them), so the
 * map is typed to that rather than to the library's `Role`: `newRole`'s return
 * is generic in the grant object, and a `Record<Position, …>` over six
 * different grant shapes has no single instantiation to name.
 */
type PositionStatements = { statements: Record<string, readonly string[]> };
const positionRoles: Record<Position, PositionStatements> = Object.fromEntries(
	positionOrder.map((p) => [p, ac.newRole(positions[p] as never) as PositionStatements])
) as Record<Position, PositionStatements>;

function isPosition(name: string): name is Position {
	return (positionOrder as readonly string[]).includes(name);
}

function requestFor(cap: Capability) {
	const dot = cap.indexOf('.');
	return { [cap.slice(0, dot)]: [cap.slice(dot + 1)] } as never;
}

/**
 * A single authorizer over the union of what these positions grant.
 *
 * Merged into one Role rather than asking "does any position authorize this",
 * so that the same object also answers the multi-resource AND-composing form
 * better-auth supports, and so `capabilitySet` can enumerate it for the UI.
 */
function authorizerFor(held: readonly Position[]) {
	const merged: Record<string, string[]> = {};
	for (const p of held) {
		for (const [resource, actions] of Object.entries(positionRoles[p].statements)) {
			const bucket = (merged[resource] ??= []);
			for (const a of actions as readonly string[]) if (!bucket.includes(a)) bucket.push(a);
		}
	}
	return buildRole(merged);
}

/** Flat `"resource.action"` list, for shipping to the client. */
export function capabilitySet(held: readonly Position[]): Capability[] {
	const statements = authorizerFor(held).statements as Record<string, readonly string[]>;
	return Object.entries(statements).flatMap(([r, as]) => as.map((a) => `${r}.${a}` as Capability));
}

/**
 * The positions a user holds.
 *
 * `roles` still carries legacy rows — `member`, `sustaining`, `volunteer` —
 * that are not positions and grant nothing. They are filtered here rather than
 * in SQL so the matrix stays the only place the list of real positions is
 * written down.
 */
export async function positionsFor(userId: string): Promise<Position[]> {
	const rows = await db
		.select({ name: role.name })
		.from(role)
		.innerJoin(modelHasRole, eq(modelHasRole.roleId, role.id))
		.where(eq(modelHasRole.userId, userId));
	return rows.map((r) => r.name).filter(isPosition);
}

/**
 * The caller's positions, resolved once per request.
 *
 * The **promise** is cached, not the resolved array. `getMemberLayout` fires
 * its guards inside one `Promise.all` and `getBandLayout` inside another;
 * caching the value would still let concurrent callers each start their own D1
 * read, because the cache is only populated after the first settles. Storing
 * the in-flight promise collapses them into one.
 *
 * Deliberately NOT resolved eagerly in `hooks.server.ts`: that handle runs on
 * every request, including public band-subdomain pages and asset requests that
 * never check a capability. Lazy ends up cheaper than the status quo, where
 * `layout.remote.ts` alone issues three role reads.
 *
 * Deliberately NOT folded into better-auth's session cookie cache either. That
 * cache answers `getSession` from a signed cookie for up to 60s with no DB
 * read, which is exactly why `deletedAt` can be a minute stale (see the
 * comment in hooks.server.ts). An authorization decision must not inherit that
 * window: revoking a position has to take effect on the caller's next request,
 * not their next minute.
 */
function currentPositions(): Promise<Position[]> {
	const { locals } = getRequestEvent();
	if (!locals.user) return Promise.resolve([]);
	return (locals.positions ??= positionsFor(locals.user.id));
}

/** Does the caller hold this capability? Never throws — for UI gating and branches. */
export async function can(cap: Capability): Promise<boolean> {
	const { locals } = getRequestEvent();
	if (!locals.user) return false;
	return authorizerFor(await currentPositions()).authorize(requestFor(cap)).success;
}

/**
 * Assert the caller holds `cap`. The first statement of a remote function.
 * Returns the authenticated user, as `requireStaff()` does.
 */
export async function requireCapability(cap: Capability) {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');
	if (!(await can(cap))) throw error(403, 'Not permitted');
	return locals.user;
}

/**
 * The explicit-user form, for code with no request event: event-bus listeners,
 * cron, anything under `src/lib/server/notification/`. `getRequestEvent()`
 * throws outside a request, so `can()` must never be reached from there — and
 * a listener failure is swallowed by `captureException`, so it would fail
 * silently.
 */
export async function userHasCapability(userId: string, cap: Capability): Promise<boolean> {
	return authorizerFor(await positionsFor(userId)).authorize(requestFor(cap)).success;
}

/**
 * Staff-or-owner, capability-scoped. Keeps the `'staff' | 'owner'` return its
 * callers branch on.
 */
export async function requireCapabilityOrOwner(
	cap: Capability,
	ownerId: string
): Promise<'staff' | 'owner'> {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');
	if (locals.user.id === ownerId) return 'owner';
	if (await can(cap)) return 'staff';
	throw error(403, 'Not authorized');
}

/** Holds at least one position — what "is staff" now means. */
export async function isElevated(userId: string): Promise<boolean> {
	return (await positionsFor(userId)).length > 0;
}

/**
 * Everyone who could act on `cap`. The referent that replaces
 * `listStaffUsers()` for notifications.
 */
export async function listUsersWithCapability(
	cap: Capability
): Promise<Array<{ id: string; name: string; email: string }>> {
	const names = positionsGranting(cap);
	if (names.length === 0) return [];
	const rows = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.innerJoin(modelHasRole, eq(modelHasRole.userId, user.id))
		.innerJoin(role, eq(role.id, modelHasRole.roleId))
		.where(inArray(role.name, names));

	// De-duplicated in JS rather than with groupBy: the specs in this directory
	// mock `drizzle-orm` export by export, so importing one more operator here
	// breaks siblings. Same reason `listStaffUsers` did it this way.
	const seen = new Set<string>();
	return rows.filter((r) => {
		if (seen.has(r.id)) return false;
		seen.add(r.id);
		return true;
	});
}

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
	if ((await currentPositions()).length === 0) throw error(403, 'Staff access required');
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
	return isElevated(userId);
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
