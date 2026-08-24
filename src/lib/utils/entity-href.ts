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

	const staff = viewer.isStaff;
	const signedIn = viewer.userId !== null;
	const inBand = (bandId: string | null | undefined) => !!bandId && viewer.bandIds.has(bandId);

	switch (ref.type) {
		case 'member': {
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/users/${id}`) });
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
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/bands/${id}`) });
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
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/events/${id}`) });
			if (ref.bandSlug && inBand(ref.bandId))
				out.push({ panel: 'band', href: resolve(`/band/${ref.bandSlug}/events/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/events/${id}`) });
			out.push({ panel: 'public', href: resolve(`/events/${id}`) });
			break;
		}

		case 'reservation': {
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/reservations/${id}`) });
			// The band panel books as a band, so the list is the closest thing it
			// has to a detail page — there is no per-reservation band route.
			if (ref.bandSlug && inBand(ref.bandId))
				out.push({ panel: 'band', href: resolve(`/band/${ref.bandSlug}/reservations`) });
			if (viewer.userId && ref.ownerUserId === viewer.userId)
				out.push({ panel: 'member', href: resolve(`/member/reservations/${id}`) });
			break;
		}

		case 'suggestion': {
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/suggestions/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/suggestions/${id}`) });
			break;
		}

		case 'thread': {
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/inbox/${id}`) });
			if (signedIn) out.push({ panel: 'member', href: resolve(`/member/messages/${id}`) });
			break;
		}

		case 'help': {
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/help/${id}`) });
			// The member-facing article is addressed by slug, the staff editor by id.
			if (signedIn && ref.slug)
				out.push({ panel: 'member', href: resolve(`/member/help/${ref.slug}`) });
			break;
		}

		// Staff-only records. A member has no page for these at all, which is why
		// `null` has to be a first-class answer rather than a fallback to "/".
		case 'flag':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/flags/${id}`) });
			break;
		case 'campaign':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/marketing/campaigns/${id}`) });
			break;
		case 'audience':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/marketing/audiences/${id}`) });
			break;
		case 'equipment':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/equipment/${id}`) });
			break;
		case 'loan':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/equipment/loans/${id}`) });
			break;
		case 'shift':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/volunteer/shifts/${id}`) });
			break;
		case 'role':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/volunteer/roles/${id}`) });
			break;
		case 'recurring':
			if (staff) out.push({ panel: 'staff', href: resolve(`/staff/recurring/${id}`) });
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
