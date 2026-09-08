/**
 * Where a record's detail page lives, for the person currently looking at it.
 *
 * Every record has exactly one canonical page *per viewer*, and the app derives
 * it rather than being told. Before this existed, band links were written by
 * hand at each call site and three of them pointed at `/directory/bands/[slug]`
 * while three pointed at `/staff/bands/[id]` — nothing decided which was right.
 *
 * Two inputs, in this order:
 *
 *  1. **Stay in the panel you are already in.** A staff user who is also in a
 *     band, clicking that band from inside its own panel, wants
 *     `/band/[slug]` — not to be thrown into the staff record.
 *  2. **Otherwise take the richest page they are entitled to**, ordered
 *     staff → band → member → public.
 *
 * `null` means no reachable page, and is a normal outcome rather than a
 * failure: the components render an unlinked `<span>`, so a row stays visible
 * and the count stays honest. That is the rule `CrossRefList` already applies
 * by hand to private members, generalised.
 *
 * **This is display logic, not authorization.** Remote functions are the
 * security boundary, so the worst a wrong answer here can do is send someone to
 * a 403. The viewer is also derived client-side from the layout query, which
 * means it can lag a role change by one refetch — fine for choosing a link,
 * never sufficient for deciding access.
 *
 * Kept free of DB and Svelte dependencies so the routing *policy* can be
 * unit-tested as a plain table, the way `directory-display.ts` is.
 */
import { resolve } from '$app/paths';
import type { EntityRef, Panel, Viewer } from '$lib/types/entity';

type Candidate = { panel: Panel; href: string };

/**
 * Every page this viewer could reach for this record, richest first.
 *
 * Order is the fallback order; the panel match takes precedence over it in
 * `entityHref`. A row appears only when its condition holds, so "can reach"
 * and "is listed" are the same thing.
 */
function candidates(ref: EntityRef, viewer: Viewer): Candidate[] {
	const out: Candidate[] = [];
	const id = ref.id;
	if (!id) return out;

	// Per-route, not a single `viewer.isStaff`. A treasurer holds the panel but
	// not the volunteer surfaces, so a blanket staff link would offer them a row
	// that 403s. The header above says a mis-derived link is a 403 and never a
	// leak; this keeps it from being a 403 either.
	const can = (cap: string) => viewer.capabilities.has(cap);
	const signedIn = viewer.userId !== null;
	const inBand = (bandId: string | null | undefined) => !!bandId && viewer.bandIds.has(bandId);

	switch (ref.type) {
		case 'member': {
			if (can('user.read')) out.push({ panel: 'staff', href: resolve(`/staff/users/${id}`) });
			if (signedIn) {
				out.push(
					id === viewer.userId
						? { panel: 'member', href: resolve('/member/profile') }
						: { panel: 'member', href: resolve(`/member/directory/members/${id}`) }
				);
			}
			out.push({ panel: 'public', href: resolve(`/directory/members/${id}`) });
			break;
		}

		case 'band': {
			if (can('band.read')) out.push({ panel: 'staff', href: resolve(`/staff/bands/${id}`) });
			// Every band route below the staff panel is keyed by slug.
			if (ref.slug) {
				if (inBand(id)) out.push({ panel: 'band', href: resolve(`/band/${ref.slug}`) });
				if (signedIn)
					out.push({ panel: 'member', href: resolve(`/member/directory/bands/${ref.slug}`) });
				out.push({ panel: 'public', href: resolve(`/directory/bands/${ref.slug}`) });
			}
			break;
		}

		case 'event': {
			if (can('event.read')) out.push({ panel: 'staff', href: resolve(`/staff/events/${id}`) });
			if (ref.bandSlug && inBand(ref.bandId))
				out.push({ panel: 'band', href: resolve(`/band/${ref.bandSlug}/events/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/events/${id}`) });
			out.push({ panel: 'public', href: resolve(`/events/${id}`) });
			break;
		}

		case 'reservation': {
			if (can('reservation.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/reservations/${id}`) });
			// The band panel books as a band, so the list is the closest thing it
			// has to a detail page — there is no per-reservation band route.
			if (ref.bandSlug && inBand(ref.bandId))
				out.push({ panel: 'band', href: resolve(`/band/${ref.bandSlug}/reservations`) });
			if (viewer.userId && ref.ownerUserId === viewer.userId)
				out.push({ panel: 'member', href: resolve(`/member/reservations/${id}`) });
			break;
		}

		case 'suggestion': {
			if (can('suggestion.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/suggestions/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/suggestions/${id}`) });
			break;
		}

		case 'thread': {
			if (can('inbox.read')) out.push({ panel: 'staff', href: resolve(`/staff/inbox/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/messages/${id}`) });
			break;
		}

		case 'help': {
			if (can('help.read')) out.push({ panel: 'staff', href: resolve(`/staff/help/${id}`) });
			// The member-facing article is addressed by slug, the staff editor by id.
			if (signedIn && ref.slug)
				out.push({ panel: 'member', href: resolve(`/member/help/${ref.slug}`) });
			break;
		}

		// Gear. Members reach the catalog and their own loans, and — since #286 —
		// the unit itself, because a printed tag on an amp is scanned by whoever
		// is standing next to it.
		case 'equipment': {
			if (can('inventory.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/inventory/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/equipment/${id}`) });
			break;
		}

		case 'asset': {
			if (can('inventory.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/inventory/assets/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/equipment/assets/${id}`) });
			// Deliberately no public arm: the gear catalog is not public, so a
			// signed-out scan gets `null` here and `/a/[tag]` turns that into a
			// login redirect rather than a 404.
			break;
		}

		case 'loan': {
			if (can('inventory.manageLoans'))
				out.push({ panel: 'staff', href: resolve(`/staff/inventory/loans/${id}`) });
			// The member panel has no per-loan page, only the list — the same
			// shape reservations already use for the band panel.
			if (signedIn) out.push({ panel: 'member', href: resolve('/member/equipment/loans') });
			break;
		}

		// Staff-only records. A member has no page for these at all, which is why
		// `null` has to be a first-class answer rather than a fallback to "/".
		case 'flag':
			if (can('moderation.reviewFlags'))
				out.push({ panel: 'staff', href: resolve(`/staff/flags/${id}`) });
			break;
		case 'campaign':
			if (can('marketing.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/marketing/campaigns/${id}`) });
			break;
		case 'audience':
			if (can('marketing.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/marketing/audiences/${id}`) });
			break;
		case 'shift':
			if (can('volunteer.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/volunteer/shifts/${id}`) });
			break;
		case 'role':
			if (can('volunteer.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/volunteer/roles/${id}`) });
			break;
		case 'recurring':
			if (can('reservation.read'))
				out.push({ panel: 'staff', href: resolve(`/staff/recurring/${id}`) });
			break;
	}

	return out;
}

/** The one canonical page for this record, this viewer, and where they are now. */
export function entityHref(ref: EntityRef, viewer: Viewer): string | null {
	const reachable = candidates(ref, viewer);
	const here = reachable.find((c) => c.panel === viewer.panel);
	return (here ?? reachable[0])?.href ?? null;
}
