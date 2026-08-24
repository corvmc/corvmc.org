import type { EntityType } from '$lib/config';

/**
 * A reference to one record, shaped for display.
 *
 * This is what a query projects when a page needs to *mention* something —
 * an inline chip, a list row, a card on a related record's page. It carries
 * identity and the two or three facts every tier shows, and nothing else.
 *
 * There is deliberately **no `href`**. A record's canonical page depends on who
 * is looking and which panel they are in, so it is derived by
 * `entityHref(ref, viewer)` in `$lib/utils/entity-href` rather than decided at
 * whichever call site happens to render the link. Passing one in was how the
 * tree ended up with band links pointing at two different routes.
 */
interface BaseRef {
	/**
	 * `null` when the record is gone — a deleted account still named on an old
	 * reservation. The row stays so the history stays honest; it just does not
	 * link. Distinct from *unreachable*, which is a viewer-dependent outcome of
	 * `entityHref` and renders the same way.
	 */
	id: string | null;
	/** The distinctive line. On a chip this is the entire payload. */
	title: string;
	/**
	 * The single closest qualifier, already merged — a member's email, a loan's
	 * item. ui-patterns' "merge before you hide" rule: if a fact only qualifies
	 * the title, it belongs here rather than in a column of its own.
	 */
	subtitle?: string | null;
	/**
	 * A resolved URL, never a storage key — `resolveImageUrl` is server-only.
	 * Absent renders the generated pattern fallback, not a broken image.
	 */
	image?: string | null;
	/**
	 * Only ever a value `StatusBadge` already knows. The two registries cannot
	 * be cross-checked statically, and an unmapped status renders a neutral dot
	 * that says nothing — worse than omitting it.
	 */
	status?: string | null;
	/**
	 * The record's own slug, where it has one. Bands and help articles are
	 * addressed by slug everywhere outside the staff panel, so a ref without it
	 * simply has fewer reachable pages rather than a broken link.
	 */
	slug?: string | null;
	/**
	 * Which variant of its type this is — `sustaining` for a member, `community`
	 * for an event. Resolved to a glyph by `entityGlyph()`.
	 *
	 * Only ever set for the *marked* cases. A plain member, a member's own
	 * booking, a CMC show: all leave this null and get no marker, because a glyph
	 * on every row marks nothing.
	 */
	subtype?: string | null;
}

export interface MemberRef extends BaseRef {
	type: 'member';
	pronouns?: string | null;
}

export interface BandRef extends BaseRef {
	type: 'band';
}

export interface EventRef extends BaseRef {
	type: 'event';
	startsAt?: Date | null;
	/** Set when a band owns the listing — unlocks its band-panel page. */
	bandId?: string | null;
	bandSlug?: string | null;
}

export interface ReservationRef extends BaseRef {
	type: 'reservation';
	/** Who booked it. Unlocks `/member/reservations/[id]` for that member. */
	ownerUserId?: string | null;
	bandId?: string | null;
	bandSlug?: string | null;
}

/** The types whose reference is identity and nothing more. */
export interface GenericRef extends BaseRef {
	type: Exclude<EntityType, 'member' | 'band' | 'event' | 'reservation'>;
}

export type EntityRef = MemberRef | BandRef | EventRef | ReservationRef | GenericRef;

/** Which panel is being rendered. `public` is the unauthenticated site. */
export type Panel = 'staff' | 'band' | 'member' | 'public';

/**
 * What the current viewer can reach, and where they are.
 *
 * Display input only — remote functions are the security boundary, so a
 * mis-derived link is a 403, never a leak. See `entity-href.ts`.
 */
export interface Viewer {
	userId: string | null;
	isStaff: boolean;
	/** Bands the viewer is an *active* member of. */
	bandIds: ReadonlySet<string>;
	panel: Panel;
}

/** No session, no panel — what an unmounted provider falls back to. */
export const ANONYMOUS: Viewer = {
	userId: null,
	isStaff: false,
	bandIds: new Set(),
	panel: 'public'
};
