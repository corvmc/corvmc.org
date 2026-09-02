import { error, redirect } from '@sveltejs/kit';
import { getUserByMemberNumber } from '$lib/server/user/member-number-service';
import { isStaff } from '$lib/server/authorization';
import { entityHref } from '$lib/utils/entity-href';
import type { Panel } from '$lib/types/entity';
import type { PageServerLoad } from './$types';

/**
 * Where a member's address lands.
 *
 * `corvmc.org/m/142` is the member half of what `{slug}.corvmc.org` already is
 * for a band: an address short enough to print on a flyer, say into a
 * microphone, or put in a bio. This route renders nothing — it resolves the
 * number to a user and hands the routing decision to `entityHref`, the same
 * policy the identity chips and cards apply: *stay in the panel you are already
 * in, otherwise take the richest page you are entitled to*.
 *
 * A `load` rather than a remote function, deliberately and against the usual
 * rule — the same departure `/a/[tag]` makes, for the same reason: this is
 * navigation, not data access, and a QR code scanned by a phone camera should
 * get a 302 straight off the server rather than a blank page that redirects
 * once JavaScript has booted.
 *
 * Two things differ from `/a/[tag]`, and both follow from the same fact: a
 * member profile has a public page and a piece of gear does not.
 *
 *  - **No login gate.** An anonymous scan of an asset tag has nowhere to go, so
 *    that route asks for a session first. Here a stranger following the address
 *    is the whole point.
 *  - **The viewer's richest panel, not `'public'`.** `/a/[tag]` passes
 *    `panel: 'public'` to make the panel match miss, leaving `entityHref`'s
 *    "richest entitled" fallback to decide. That trick relies on there being no
 *    public arm for gear. A member has one, so `'public'` would match it and
 *    pin every viewer — staff included — to the public profile. Naming the
 *    panel the viewer actually holds asks `entityHref` the question this route
 *    means: not *where are you standing*, since it is standing nowhere, but
 *    *what is the best page you are entitled to*.
 *
 * Because the redirect lives here, the address on a printed flyer never has to
 * change when the pages behind it move.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	// `Number('12abc')` is NaN but `parseInt` would take it, and `Number(' 12 ')`
	// is 12 — neither is the address that was printed. Only digits resolve.
	const memberNumber = /^\d+$/.test(params.memberNumber) ? Number(params.memberNumber) : NaN;
	if (!Number.isSafeInteger(memberNumber) || memberNumber <= 0) {
		error(404, 'No member carries that number');
	}

	const found = await getUserByMemberNumber(memberNumber);
	if (!found) error(404, 'No member carries that number');

	const staff = locals.user ? await isStaff(locals.user.id) : false;
	const panel: Panel = staff ? 'staff' : locals.user ? 'member' : 'public';
	const href = entityHref(
		{ type: 'member', id: found.id, title: found.name },
		{ userId: locals.user?.id ?? null, isStaff: staff, bandIds: new Set(), panel }
	);

	// `entityHref` always has a public arm for a member, so the fallback is
	// unreachable rather than a policy — it exists so a future change to the
	// member candidates cannot turn this into a crash.
	redirect(302, href ?? `/directory/members/${found.id}`);
};
