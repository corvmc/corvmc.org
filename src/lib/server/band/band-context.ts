import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { requireUser, hasAnyRole } from '$lib/server/authorization';
import { getBySlug, getUserRole } from '$lib/server/band/band-service';

/**
 * Resolve a band from the current request's `params.slug`.
 * Throws 400 if the request carries no slug, 404 if no such band exists.
 *
 * The slug cannot be asserted non-null. Remote functions are their own endpoint
 * under `/_app/remote/...`; they do not run inside a route load, and the
 * pathname their params are resolved against comes from a client-supplied
 * header. A query issued from `/band/[slug]` that lands after the browser has
 * navigated away arrives with the *new* pathname, so `params.slug` is simply
 * absent — see JAVASCRIPT-SVELTEKIT-2T, where `getBandUpcoming` reached D1 with
 * an undefined bind parameter and turned a raced navigation into a 500
 * (`D1_TYPE_ERROR: Type 'undefined' not supported`).
 */
export async function requireBandBySlug() {
	const { params } = getRequestEvent();
	const slug = params.slug;
	if (!slug) throw error(400, 'No band in request context');
	const band = await getBySlug(slug);
	if (!band) throw error(404, 'Band not found');
	return band;
}

/**
 * Require that the current user is a member of the band (resolved from slug).
 * Returns { user, band, role }.
 */
export async function requireBandMember() {
	const user = requireUser();
	const band = await requireBandBySlug();
	const role = await getUserRole(band.id, user.id);
	if (!role) throw error(403, 'Not a member of this band');
	return { user, band, role };
}

/**
 * Require membership OR staff, for band-panel *reads*.
 *
 * Staff administer band panels (`getBandLayout` falls back to `userRole:
 * 'staff'`), so a plain `requireBandMember` would lock them out. Mutations stay
 * on `requireBandAdmin` — this is the read-side guard, and it exists because
 * `requireUser()` alone let any signed-in user pull another band's drafts.
 */
export async function requireBandMemberOrStaff() {
	const user = requireUser();
	const band = await requireBandBySlug();
	const role = await getUserRole(band.id, user.id);
	if (role) return { user, band, role };

	if (await hasAnyRole(user.id, ['admin', 'staff'])) {
		return { user, band, role: 'staff' as const };
	}
	throw error(403, 'Not a member of this band');
}

const HIERARCHY: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Require that the current user holds at least `minRole` in the band.
 * Role hierarchy: owner > admin > member.
 */
export async function requireBandRole(minRole: 'owner' | 'admin' | 'member') {
	const ctx = await requireBandMember();
	if (HIERARCHY[ctx.role] > HIERARCHY[minRole]) {
		throw error(403, 'Insufficient permissions');
	}
	return ctx;
}

/** Shorthand: require at least admin role in the band. */
export async function requireBandAdmin() {
	return requireBandRole('admin');
}

/** Shorthand: require owner role in the band. */
export async function requireBandOwner() {
	return requireBandRole('owner');
}
