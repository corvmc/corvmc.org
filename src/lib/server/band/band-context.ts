import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { requireUser } from '$lib/server/authorization';
import { getBySlug } from '$lib/server/band/band-service';
import { requireGroupRole, type GroupContext } from '$lib/server/group/group-context';

/**
 * @deprecated Phase 4 of docs/specs/groups-spec.md replaces these with
 * `requireGroupRole(ref, minRole, opts)` from `$lib/server/group/group-context`,
 * which takes the group as an explicit argument.
 *
 * Everything here is a thin wrapper that reads `params.slug` and passes it on,
 * kept for one release so the guard and the call-site port land in separate
 * reviewable diffs. `params` in a remote function describe the *calling page*
 * and come from a client-supplied header, which is exactly why they are going
 * away — see the ref doc on `GroupRef`.
 */

/**
 * The slug cannot be asserted non-null. Remote functions are their own endpoint
 * under `/_app/remote/...`; they do not run inside a route load, and the
 * pathname their params are resolved against comes from a client-supplied
 * header. A query issued from `/band/[slug]` that lands after the browser has
 * navigated away arrives with the *new* pathname, so `params.slug` is simply
 * absent — see JAVASCRIPT-SVELTEKIT-2T, where `getBandUpcoming` reached D1 with
 * an undefined bind parameter and turned a raced navigation into a 500
 * (`D1_TYPE_ERROR: Type 'undefined' not supported`).
 */
function slugFromRequest(): string {
	const { params } = getRequestEvent();
	const slug = params.slug;
	if (!slug) throw error(400, 'No band in request context');
	return slug;
}

/**
 * Band-shaped view of a group context, for the call sites not yet ported.
 *
 * `requireUser()` runs before the slug is read so a signed-out caller still
 * gets 401 rather than the 400 a missing slug would otherwise produce first —
 * the order these guards had before they delegated.
 */
async function bandContext(minRole: 'owner' | 'admin' | 'member', opts?: { allowStaff?: boolean }) {
	requireUser();
	const ctx: GroupContext = await requireGroupRole({ slug: slugFromRequest() }, minRole, opts);
	return { user: ctx.user, band: ctx.group, role: ctx.role };
}

/** @deprecated Resolve the group explicitly and use `requireGroupRole`. */
export async function requireBandBySlug() {
	const band = await getBySlug(slugFromRequest());
	if (!band) throw error(404, 'Band not found');
	return band;
}

/** @deprecated Use `requireGroupRole({ slug }, 'member')`. */
export async function requireBandMember() {
	return bandContext('member');
}

/** @deprecated Use `requireGroupRole({ slug }, 'member', { allowStaff: true })`. */
export async function requireBandMemberOrStaff() {
	return bandContext('member', { allowStaff: true });
}

/** @deprecated Use `requireGroupRole({ slug }, minRole)`. */
export async function requireBandRole(minRole: 'owner' | 'admin' | 'member') {
	return bandContext(minRole);
}

/** @deprecated Use `requireGroupRole({ slug }, 'admin')`. */
export async function requireBandAdmin() {
	return requireBandRole('admin');
}

/** @deprecated Use `requireGroupRole({ slug }, 'owner')`. */
export async function requireBandOwner() {
	return requireBandRole('owner');
}
