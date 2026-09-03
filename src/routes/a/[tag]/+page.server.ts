import { error, redirect } from '@sveltejs/kit';
import { getAssetByTag } from '$lib/server/inventory/asset-service';
import { capabilitySet, positionsFor } from '$lib/server/authorization';
import { entityHref } from '$lib/utils/entity-href';
import type { PageServerLoad } from './$types';

/**
 * Where a scanned tag lands.
 *
 * This route renders nothing. It resolves the tag to a unit and hands the
 * routing decision to `entityHref` — the same policy the identity chips and
 * cards already apply: *stay in the panel you are already in, otherwise take the
 * richest page you are entitled to*. Staff get the operational record, a member
 * gets the unit's own page.
 *
 * A `load` rather than a remote function, deliberately and against the usual
 * rule: this is navigation, not data access, and a QR code scanned by a phone
 * camera should get a 302 straight off the server rather than a blank page that
 * redirects once JavaScript has booted.
 *
 * The viewer is built with `panel: 'public'` because this route sits outside all
 * three panels. Nothing has a public arm for gear, so the panel match always
 * misses and the "richest entitled" fallback decides — which is exactly the
 * wanted behaviour here.
 *
 * Because the redirect lives here, the URL printed on a physical sticker never
 * has to change when the pages behind it move. That matters when it is stuck to
 * two hundred amps.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const tag = params.tag;

	// A tag is a physical object in a room full of people who may not be signed
	// in on their phone, so this is the common path rather than an edge case —
	// and it answers with a login, not a dead end. Checked before the lookup so
	// an anonymous scan cannot probe which tags exist.
	if (!locals.user) redirect(302, `/login?redirect=/a/${encodeURIComponent(tag)}`);

	const asset = await getAssetByTag(tag);
	if (!asset) error(404, 'No gear carries that tag');

	// The real capability set, not just `isStaff`: entityHref decides the staff
	// arm per route now, so a coarse boolean would send someone who holds the
	// panel but not inventory to a page that 403s.
	const positions = await positionsFor(locals.user.id);
	const href = entityHref(
		{ type: 'asset', id: asset.id, title: asset.item.name },
		{
			userId: locals.user.id,
			isStaff: positions.length > 0,
			capabilities: new Set(capabilitySet(positions)),
			bandIds: new Set(),
			panel: 'public'
		}
	);

	redirect(302, href ?? '/member/equipment');
};
