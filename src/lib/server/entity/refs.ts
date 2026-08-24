/**
 * Projecting a record into the `EntityRef` its components expect, from SQL.
 *
 * A ref should reach a component already knowing what it is: its glyph, its
 * subtitle and its status are decided once, here, rather than assembled by
 * whichever page happens to render it. `MemberLink` proved the alternative —
 * the role-versus-subscription rule was written out at the call site, so the
 * one page that forgot `sustaining` quietly showed sustaining members as
 * ordinary ones.
 *
 * Two halves, kept apart on purpose:
 *
 *  - `memberRefColumns` is the *projection* — drop it into a drizzle
 *    `.select()` under one key and the row comes back with a nested object.
 *  - `toMemberRef` is the *mapping*, and is pure apart from `resolveImageUrl`.
 *
 * **A ref may only use columns from joins the query already makes.** Where a
 * query has the user's id and name but no join to `user`, pass what it has and
 * accept a `null` image; adding a join per row to fetch an avatar is an N+1
 * dressed as a projection.
 */
import type { BuildAliasTable } from 'drizzle-orm/sqlite-core';
import { user } from '$lib/server/db/schema/authentication';
import { band } from '$lib/server/db/schema/band';
import { event } from '$lib/server/db/schema/event';
import { reservation } from '$lib/server/db/schema/reservation';
import { primaryRoleFor } from '$lib/server/authorization';
import { isSustainingMemberSql } from '$lib/server/finance/subscription-service';
import { resolveImageUrl } from '$lib/server/storage';
import { memberSubtype } from '$lib/utils/entity-ref';
import { entityLabels, flagEntityTypeToEntity } from '$lib/config';
import { formatDate, formatDuration, formatTimeRange } from '$lib/utils/format';
import type {
	BandRef,
	EntityRef,
	EventRef,
	GenericRef,
	MemberRef,
	ReservationRef
} from '$lib/types/entity';

/**
 * The `user` table, or any `alias()` of it — the alias arm is what lets a query
 * that joins `user` twice project a ref for each side.
 */
type UserTable = typeof user | BuildAliasTable<typeof user, string>;

/**
 * The columns a member ref needs, for `select({ member: memberRefColumns(u) })`.
 *
 * `role` and `sustaining` are the two correlated subqueries the staff pages
 * already use one at a time; taking both together is what lets `toMemberRef`
 * apply the precedence rule instead of each page guessing at it.
 *
 * Both subqueries are keyed off the id column that is passed in, so an aliased
 * `user` correlates to its alias — which is what makes this usable on the
 * queries that join `user` twice (a booking's member and its approver).
 */
export function memberRefColumns(u: UserTable = user) {
	return {
		id: u.id,
		name: u.name,
		email: u.email,
		pronouns: u.pronouns,
		image: u.image,
		role: primaryRoleFor(u.id),
		sustaining: isSustainingMemberSql(u.id)
	};
}

/**
 * What `toMemberRef` needs, which is less than `memberRefColumns` returns.
 *
 * Every field past the id is optional so a query that only has a name and a
 * user id can still produce a ref — see the N+1 note above.
 */
export interface MemberRefRow {
	id: string | null;
	name: string | null;
	email?: string | null;
	pronouns?: string | null;
	/** A storage key, not a URL: `resolveImageUrl` runs here. */
	image?: string | null;
	role?: string | null;
	/** SQLite has no booleans, so the correlated subquery lands as 0 or 1. */
	sustaining?: boolean | number | null;
}

/**
 * A member ref, including for a member who is no longer there.
 *
 * A left join that missed — a reservation whose account was deleted — comes
 * back as `null` and still gets a ref: `id: null` renders an unlinked row, so
 * the history stays visible and the count stays honest. Losing the row instead
 * would silently change what a page reports.
 */
export function toMemberRef(row: MemberRefRow | null | undefined): MemberRef {
	return {
		type: 'member',
		id: row?.id ?? null,
		title: row?.name ?? 'Unknown member',
		subtitle: row?.email ?? null,
		pronouns: row?.pronouns ?? null,
		image: resolveImageUrl(row?.image),
		subtype: memberSubtype(row?.role, !!row?.sustaining)
	};
}

// ---------------------------------------------------------------------------
// Band
// ---------------------------------------------------------------------------

type BandTable = typeof band | BuildAliasTable<typeof band, string>;

/**
 * `slug` is not optional dressing: every band route outside the staff panel is
 * keyed by it, so a ref without one simply has fewer reachable pages.
 *
 * No status. A band's `tier` is the only state it has, and `premium` on every
 * premium band marks nothing — the rule the registry states for subtypes.
 */
export function bandRefColumns(b: BandTable = band) {
	return { id: b.id, name: b.name, slug: b.slug, image: b.avatarKey };
}

export interface BandRefRow {
	id: string | null;
	name: string | null;
	slug?: string | null;
	image?: string | null;
}

export function toBandRef(row: BandRefRow | null | undefined): BandRef {
	return {
		type: 'band',
		id: row?.id ?? null,
		title: row?.name ?? 'Unknown band',
		slug: row?.slug ?? null,
		image: resolveImageUrl(row?.image)
	};
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

type EventTable = typeof event | BuildAliasTable<typeof event, string>;

export function eventRefColumns(e: EventTable = event) {
	return { id: e.id, title: e.title, status: e.status, startsAt: e.startsAt, image: e.posterKey };
}

export interface EventRefRow {
	id: string | null;
	title: string | null;
	status?: string | null;
	startsAt?: Date | null;
	image?: string | null;
}

export function toEventRef(row: EventRefRow | null | undefined): EventRef {
	return {
		type: 'event',
		id: row?.id ?? null,
		title: row?.title ?? 'Unknown event',
		status: row?.status ?? null,
		startsAt: row?.startsAt ?? null,
		image: resolveImageUrl(row?.image)
	};
}

// ---------------------------------------------------------------------------
// Booker
// ---------------------------------------------------------------------------

/**
 * Who a reservation is *for*, which is not one type of record.
 *
 * `bookerType` picks between three tables, so the ref does too — and the chip
 * that renders it carries its type glyph, which is how a reader tells a band's
 * booking from a member's without a column of icons beside it.
 *
 * The branch lives here rather than at the call site because it is a fact about
 * the data, and because a page that branched on it would be back to deciding
 * per-site what a booking looks like.
 *
 * `lesson` has no record to point at: nothing in this app writes that booker
 * type — it arrives with migrated rows — so it resolves to the member who holds
 * the booking, and the reservation keeps its own lesson glyph to say what it is.
 */
export function toBookerRef(row: {
	bookerType: string;
	member: MemberRefRow | null;
	band?: BandRefRow | null;
	event?: EventRefRow | null;
}): EntityRef {
	// A left join that missed — a deleted band, a purged event — still gets its
	// own ref rather than silently reporting as a member booking. `id: null`
	// renders unlinked, so the row stays honest about what it is.
	if (row.bookerType === 'band') return toBandRef(row.band);
	if (row.bookerType === 'event') return toEventRef(row.event);
	return toMemberRef(row.member);
}

// ---------------------------------------------------------------------------
// Reservation
// ---------------------------------------------------------------------------

type ReservationTable = typeof reservation | BuildAliasTable<typeof reservation, string>;

export function reservationRefColumns(r: ReservationTable = reservation) {
	return {
		id: r.id,
		status: r.status,
		startsAt: r.startsAt,
		endsAt: r.endsAt,
		bookerType: r.bookerType,
		ownerUserId: r.createdByUserId
	};
}

export interface ReservationRefRow {
	id: string | null;
	status?: string | null;
	startsAt: Date;
	endsAt: Date;
	bookerType?: string | null;
	ownerUserId?: string | null;
}

/**
 * A booking as a record: the slot it holds, and who can reach it.
 *
 * The title is formatted here rather than at the call site, which is safe
 * because `$lib/utils/format` pins `DEFAULT_TIMEZONE` on every formatter it
 * builds — venue time, not the reader's and not the server's. A booking is a
 * room at an hour, so the club's clock is the only one that means anything;
 * formatting it on the server changes the string not at all.
 *
 * `band` unlocks the band panel's route, `ownerUserId` the booker's own. A
 * band has no per-reservation page yet (see CHORES), so today the band arm of
 * `entityHref` lands on the list — the ref is right either way, and the page
 * appearing is what changes the answer.
 */
export function toReservationRef(
	row: ReservationRefRow,
	band?: { id: string | null; slug: string | null } | null
): ReservationRef {
	return {
		type: 'reservation',
		id: row.id,
		title: `${formatDate(row.startsAt)} · ${formatTimeRange(row.startsAt, row.endsAt)}`,
		subtitle: formatDuration(row.startsAt, row.endsAt),
		status: row.status ?? null,
		// Exception-only: a member booking for themselves is the ordinary case and
		// is absent from the registry, so it resolves to no marker.
		subtype: row.bookerType ?? null,
		ownerUserId: row.ownerUserId ?? null,
		bandId: band?.id ?? null,
		bandSlug: band?.slug ?? null
	};
}

// ---------------------------------------------------------------------------
// Flag target
// ---------------------------------------------------------------------------

/**
 * What a report is *about*, as a record.
 *
 * `contentFlag.entityType` has its own vocabulary — older, narrower, and named
 * after the profile rather than the record behind it — so `flagEntityTypeToEntity`
 * bridges the two and `registry.spec.ts` asserts it covers every value. Before
 * this, `staff/flags/[id]` carried a hand-written label map and a five-deep
 * ternary that rebuilt each route by hand, one arm of which pointed at the
 * public listing while the staff record sat one click away.
 *
 * The label is passed in rather than looked up again: `getFlag` has already
 * resolved it, and for a direct conversation that label is deliberately a
 * content-free constant rather than the subject line.
 *
 * **A flagged conversation gets `id: null` on purpose.** A direct thread has no
 * staff page — the report is the only way to see it, which is the whole design
 * of `getThread` — so the ref must not resolve to `/staff/inbox/[id]`. Unlinked
 * is the honest rendering, and the page shows the thread inline anyway.
 */
export function toFlagTargetRef(
	entityType: string,
	entityId: string,
	label: string | null
): EntityRef {
	const type = flagEntityTypeToEntity[entityType] ?? 'member';
	return {
		type,
		id: type === 'thread' ? null : entityId,
		title: label ?? '(deleted)'
	} as EntityRef;
}

// ---------------------------------------------------------------------------
// The types whose reference is identity and nothing more
// ---------------------------------------------------------------------------

/**
 * A ref for the types that carry no relationships of their own — a suggestion,
 * a campaign, an audience, an equipment item, a loan, a help article, a thread.
 *
 * One constructor rather than seven near-identical ones, because
 * `types/entity.ts` already models them as a single `GenericRef`: they have an
 * id, a title, and at most a subtitle and a status. A type that grows a
 * relationship — the way `event` has a band and `reservation` a booker — earns
 * its own function at that point, and stops being generic.
 */
export function toGenericRef(
	type: GenericRef['type'],
	row: {
		id: string | null;
		title: string | null;
		subtitle?: string | null;
		status?: string | null;
		slug?: string | null;
		image?: string | null;
	}
): GenericRef {
	return {
		type,
		id: row.id,
		title: row.title ?? `Unknown ${entityLabels[type].one.toLowerCase()}`,
		subtitle: row.subtitle ?? null,
		status: row.status ?? null,
		slug: row.slug ?? null,
		image: resolveImageUrl(row.image)
	};
}
