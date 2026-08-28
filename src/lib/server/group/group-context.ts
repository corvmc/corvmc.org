import { error } from '@sveltejs/kit';
import { requireUser, hasAnyRole } from '$lib/server/authorization';
import type { GroupRole } from '$lib/server/db/schema/group';
import { getBySlug, getByIdActive, getUserRole } from '$lib/server/band/band-service';

/**
 * How a caller names the group it is acting on.
 *
 * Always an explicit argument, never `getRequestEvent().params`. A remote
 * function is its own endpoint under `/_app/remote/...`; it does not run inside
 * a route load, and the pathname its params resolve against comes from a
 * client-supplied header describing the *calling page*. SvelteKit's own docs
 * are explicit that this must never determine authorization.
 *
 * Passing the ref is not a weakening. A slug is a lookup key, not a
 * capability: the guard resolves the group from the untrusted ref and then
 * checks the caller's own membership on the *resolved* group, so naming a
 * group you have no role in lands you at 403 rather than inside it.
 *
 * It is also what lets one guard serve two route roots — `/band/{slug}` and,
 * from phase 5, `/member/groups/{slug}`. Reading `params` could only tell them
 * apart by sniffing `route.id`, which is the same untrusted value.
 */
export type GroupRef = { slug: string } | { id: string };

export type ResolvedGroup = NonNullable<Awaited<ReturnType<typeof getBySlug>>>;

export type GroupContext = {
	user: ReturnType<typeof requireUser>;
	group: ResolvedGroup;
	role: GroupRole | 'staff';
};

const HIERARCHY: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Resolve a group from an explicit ref and require the caller holds at least
 * `minRole` in it. Hierarchy: owner > admin > member.
 *
 * `allowStaff` admits an `admin`/`staff` user who is not a member, reported as
 * `role: 'staff'`. It bypasses `minRole` rather than being ranked against it:
 * passing it IS the decision that staff may do this thing, and a second,
 * invisible rule about where staff sits in a group hierarchy they have no
 * place in would only make that decision harder to read.
 *
 * It settles a live inconsistency. `getBandLayout` already lets staff render a
 * band panel as `userRole: 'staff'` while the mutation guards 403 them, so a
 * staff member currently sees a panel in which every action fails. Reads pass
 * it; destructive writes do not.
 *
 * Throws 400 on a blank ref, 404 when no live group matches, 403 otherwise.
 */
export async function requireGroupRole(
	ref: GroupRef,
	minRole: 'owner' | 'admin' | 'member',
	opts?: { allowStaff?: boolean }
): Promise<GroupContext> {
	const user = requireUser();
	const group = await resolveGroup(ref);

	const role = await getUserRole(group.id, user.id);
	if (role) {
		if (HIERARCHY[role] > HIERARCHY[minRole]) throw error(403, 'Insufficient permissions');
		return { user, group, role };
	}

	if (opts?.allowStaff && (await hasAnyRole(user.id, ['admin', 'staff']))) {
		return { user, group, role: 'staff' };
	}

	throw error(403, 'Not a member of this group');
}

/**
 * Resolve the ref, or throw.
 *
 * The blank-ref check is deliberate and is a regression guard, not a
 * formality: `getBySlug(undefined)` reaches D1 with an undefined bind
 * parameter and returns `D1_TYPE_ERROR: Type 'undefined' not supported`, a 500
 * where a 4xx belongs (JAVASCRIPT-SVELTEKIT-2T, where a raced navigation left
 * `params.slug` absent). An explicit ref removes that cause, but a caller can
 * still hand over an empty string.
 *
 * It does NOT follow a released slug into its replacement. That redirect lives
 * in `getBandLayout`, because throwing a redirect out of a mutation discards
 * the submitted form — see the comment there.
 */
async function resolveGroup(ref: GroupRef) {
	if ('slug' in ref) {
		if (typeof ref.slug !== 'string' || !ref.slug.trim()) {
			throw error(400, 'No group in request context');
		}
		const group = await getBySlug(ref.slug);
		if (!group) throw error(404, 'Group not found');
		return group;
	}

	if (typeof ref.id !== 'string' || !ref.id.trim()) {
		throw error(400, 'No group in request context');
	}
	const group = await getByIdActive(ref.id);
	if (!group) throw error(404, 'Group not found');
	return group;
}
