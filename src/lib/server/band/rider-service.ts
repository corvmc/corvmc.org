import { db } from '$lib/server/db';
import { rider, riderElement, riderInput } from '$lib/server/db/schema/rider';
import { group, groupMember } from '$lib/server/db/schema/group';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { eventBand } from '$lib/server/db/schema/event';
import { mediaAttachment } from '$lib/server/db/schema/media';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import {
	riderElementKinds,
	RIDER_ELEMENT_LABEL_MAX,
	RIDER_INPUT_LABEL_MAX,
	RIDER_ITEM_NOTES_MAX,
	RIDER_MAX_ELEMENTS,
	RIDER_MAX_INPUTS_PER_ELEMENT,
	RIDER_MIC_PREF_MAX,
	RIDER_NOTES_MAX,
	type RiderElementKind,
	type RiderInputSource,
	type RiderMonitorFormat,
	type RiderProvidedBy,
	type RiderStandType
} from '$lib/config';

/**
 * A band's tech rider — the input list, the gear, and who answers for each bit.
 *
 * **Nothing here stores a channel number.** They are derived on read by
 * `numberChannels`, the same treatment `getProjectBurn` gives burn and
 * `listLateOrders` gives lateness: a member adding a tom mic renumbers
 * everything below it, and a stored number would need something to come along
 * and keep it right.
 *
 * **The per-member split is the point.** `saveOwnElements` can only ever touch
 * rows the caller owns — it takes no owner argument at all, the way
 * `updateMyBandMembership` takes no member id — and `saveElementsFor` is the
 * separate, admin-guarded path that names one. Two functions rather than one
 * with a flag, because the flag is the thing that gets passed wrong.
 */

/** A placement naming an element that is not on this rider, or not the caller's. */
export class RiderNotPlaceableError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'RiderNotPlaceableError';
	}
}

/** More elements or inputs than any real band, and than one payload should carry. */
export class RiderTooLargeError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'RiderTooLargeError';
	}
}

export interface RiderInputView {
	id: string;
	/** Derived, never stored. Null on an element with no inputs of its own. */
	channel: number;
	label: string;
	source: RiderInputSource;
	micPref: string | null;
	phantom: boolean;
	stand: RiderStandType;
	monitorMixUserId: string | null;
	notes: string | null;
}

export interface RiderElementView {
	id: string;
	userId: string | null;
	/** Percent of the stage, or null when nobody has placed it yet. */
	x: number | null;
	y: number | null;
	ownerName: string | null;
	kind: RiderElementKind;
	label: string;
	providedBy: RiderProvidedBy;
	notes: string | null;
	sortOrder: number;
	inputs: RiderInputView[];
}

export interface RiderView {
	/** Null until somebody saves something — an unstarted rider is not a row. */
	id: string | null;
	groupId: string;
	techContactUserId: string | null;
	monitorFormat: RiderMonitorFormat | null;
	notes: string | null;
	confirmedAt: Date | null;
	updatedAt: Date | null;
	elements: RiderElementView[];
	/** Totals an engineer asks for first, all derived from `elements`. */
	channelCount: number;
	phantomCount: number;
	monitorMixCount: number;
	/** How many elements the band is asking CMC to supply. */
	venueProvidedCount: number;
}

export interface RiderInputDraft {
	label: string;
	source: RiderInputSource;
	micPref?: string | null;
	phantom?: boolean;
	stand?: RiderStandType;
	monitorMixUserId?: string | null;
	notes?: string | null;
}

export interface RiderElementDraft {
	kind: RiderElementKind;
	label: string;
	providedBy?: RiderProvidedBy;
	notes?: string | null;
	inputs?: RiderInputDraft[];
}

const KIND_RANK = new Map<RiderElementKind, number>(riderElementKinds.map((k, i) => [k, i]));

/**
 * The canonical channel order: kind first, then the owner's own ordering, then
 * label.
 *
 * Kind comes first because that is the order an engineer reads — drums, bass,
 * guitars and keys, then vocals — and because deriving the spine from the
 * vocabulary is what lets two members edit their own corners without either
 * one renumbering the other. `sortOrder` and `label` only ever break ties
 * inside one kind.
 */
export function compareElements(
	a: Pick<RiderElementView, 'kind' | 'sortOrder' | 'label'>,
	b: Pick<RiderElementView, 'kind' | 'sortOrder' | 'label'>
): number {
	const rank = (KIND_RANK.get(a.kind) ?? 0) - (KIND_RANK.get(b.kind) ?? 0);
	if (rank !== 0) return rank;
	if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
	return a.label.localeCompare(b.label);
}

/**
 * Walk the sorted elements and number every input 1..n.
 *
 * Pure, and exported so it can be tested without a database — the numbering is
 * the one piece of this module a wrong answer in would be invisible until an
 * engineer was standing at a desk.
 */
export function numberChannels(elements: RiderElementView[]): RiderElementView[] {
	const sorted = [...elements].sort(compareElements);
	let channel = 0;
	return sorted.map((el) => ({
		...el,
		inputs: el.inputs.map((input) => ({ ...input, channel: ++channel }))
	}));
}

function trim(value: string | null | undefined, max: number): string | null {
	const v = value?.trim();
	if (!v) return null;
	return v.length > max ? v.slice(0, max) : v;
}

function assertSize(elements: RiderElementDraft[]) {
	if (elements.length > RIDER_MAX_ELEMENTS) {
		throw new RiderTooLargeError(`A rider can hold at most ${RIDER_MAX_ELEMENTS} items.`);
	}
	for (const el of elements) {
		if ((el.inputs?.length ?? 0) > RIDER_MAX_INPUTS_PER_ELEMENT) {
			throw new RiderTooLargeError(
				`One item can hold at most ${RIDER_MAX_INPUTS_PER_ELEMENT} inputs.`
			);
		}
	}
}

/** The rider row for a band, or null. Creates nothing — reads must not write. */
export async function findRider(groupId: string) {
	const rows = await db.select().from(rider).where(eq(rider.groupId, groupId)).limit(1);
	return rows[0] ?? null;
}

/**
 * The rider row, created if this is the band's first save.
 *
 * Racy in principle — two members saving at the same instant could both miss
 * the select — which is what `uq_rider_group` is for: the loser's insert fails
 * and the retry finds the winner's row.
 */
export async function ensureRider(groupId: string): Promise<string> {
	const existing = await findRider(groupId);
	if (existing) return existing.id;
	try {
		const [created] = await db.insert(rider).values({ groupId }).returning({ id: rider.id });
		return created.id;
	} catch {
		const retry = await findRider(groupId);
		if (retry) return retry.id;
		throw new Error('Could not create rider');
	}
}

/** The whole rider, numbered, with owner names resolved for display. */
export async function getRider(groupId: string): Promise<RiderView> {
	const head = await findRider(groupId);

	const empty: RiderView = {
		id: head?.id ?? null,
		groupId,
		techContactUserId: head?.techContactUserId ?? null,
		monitorFormat: head?.monitorFormat ?? null,
		notes: head?.notes ?? null,
		confirmedAt: head?.confirmedAt ?? null,
		updatedAt: head?.updatedAt ?? null,
		elements: [],
		channelCount: 0,
		phantomCount: 0,
		monitorMixCount: 0,
		venueProvidedCount: 0
	};
	if (!head) return empty;

	const elementRows = await db
		.select({
			id: riderElement.id,
			userId: riderElement.userId,
			// The band's word for who this is: the stage name they set on this
			// roster, falling back to the account name. `getMembers` makes the same
			// choice for the same reason, and the two have to agree — the input list
			// shows an owner beside every channel and a monitor mix beside some, and
			// one person appearing as "Slim" in one column and "Jordan Murphy" in
			// the next reads as two people.
			ownerName: sql<string | null>`coalesce(${groupMember.alias}, ${user.name})`.as('owner_name'),
			kind: riderElement.kind,
			label: riderElement.label,
			providedBy: riderElement.providedBy,
			notes: riderElement.notes,
			sortOrder: riderElement.sortOrder,
			x: riderElement.x,
			y: riderElement.y
		})
		.from(riderElement)
		.leftJoin(user, eq(user.id, riderElement.userId))
		.leftJoin(
			groupMember,
			and(eq(groupMember.groupId, groupId), eq(groupMember.userId, riderElement.userId))
		)
		.where(eq(riderElement.riderId, head.id))
		.orderBy(asc(riderElement.sortOrder));

	if (elementRows.length === 0) return empty;

	const inputRows = await db
		.select()
		.from(riderInput)
		.where(
			inArray(
				riderInput.elementId,
				elementRows.map((e) => e.id)
			)
		)
		.orderBy(asc(riderInput.sortOrder));

	const byElement = new Map<string, RiderInputView[]>();
	for (const row of inputRows) {
		const list = byElement.get(row.elementId) ?? [];
		list.push({
			id: row.id,
			channel: 0,
			label: row.label,
			source: row.source,
			micPref: row.micPref,
			phantom: row.phantom,
			stand: row.stand,
			monitorMixUserId: row.monitorMixUserId,
			notes: row.notes
		});
		byElement.set(row.elementId, list);
	}

	const elements = numberChannels(
		elementRows.map((el) => ({ ...el, inputs: byElement.get(el.id) ?? [] }))
	);

	const allInputs = elements.flatMap((e) => e.inputs);

	return {
		...empty,
		elements,
		channelCount: allInputs.length,
		phantomCount: allInputs.filter((i) => i.phantom).length,
		monitorMixCount: elements.filter((e) => e.kind === 'monitor').length,
		venueProvidedCount: elements.filter((e) => e.providedBy === 'venue').length
	};
}

/**
 * Replace one owner's elements wholesale.
 *
 * Delete-then-insert rather than a diff, following `setStaffEventLineup`: the
 * submitted payload is the whole truth for that owner, `sortOrder` is
 * re-derived from array position so no client can post an order, and the
 * inserts are chunked because D1 caps a statement at 100 bound parameters.
 *
 * Scoped by `(riderId, ownerUserId)` — an owner's save can never reach another
 * member's rows even if the payload claimed to.
 */
async function replaceElementsForOwner(
	riderId: string,
	ownerUserId: string | null,
	elements: RiderElementDraft[]
) {
	const ownerFilter = ownerUserId
		? and(eq(riderElement.riderId, riderId), eq(riderElement.userId, ownerUserId))
		: and(eq(riderElement.riderId, riderId), isNull(riderElement.userId));

	// The children go first and by id: `on delete cascade` covers the delete
	// below, but naming them keeps this readable next to the batch that follows.
	// The placements come back with the ids. Delete-and-reinsert mints new ones,
	// so without this every save from the rider editor would silently unplace
	// that member's gear from the stage plot — a page they were not even looking
	// at. Label is the only stable handle a draft carries; a renamed item loses
	// its spot, which is the right outcome for what reads as a different thing.
	const doomed = await db
		.select({
			id: riderElement.id,
			label: riderElement.label,
			x: riderElement.x,
			y: riderElement.y
		})
		.from(riderElement)
		.where(ownerFilter);

	const placedByLabel = new Map(
		doomed
			.filter((d) => d.x !== null && d.y !== null)
			.map((d) => [d.label, { x: d.x, y: d.y }] as const)
	);

	if (doomed.length) {
		await db.delete(riderElement).where(
			inArray(
				riderElement.id,
				doomed.map((d) => d.id)
			)
		);
	}

	if (!elements.length) return;

	const elementRows = elements.map((el, i) => {
		const label = trim(el.label, RIDER_ELEMENT_LABEL_MAX) ?? 'Untitled';
		const placed = placedByLabel.get(label);
		return {
			id: crypto.randomUUID(),
			riderId,
			userId: ownerUserId,
			kind: el.kind,
			label,
			providedBy: el.providedBy ?? ('band' as const),
			notes: trim(el.notes, RIDER_ITEM_NOTES_MAX),
			sortOrder: i,
			x: placed?.x ?? null,
			y: placed?.y ?? null
		};
	});

	const inputRows = elements.flatMap((el, i) =>
		(el.inputs ?? []).map((input, j) => ({
			elementId: elementRows[i].id,
			label: trim(input.label, RIDER_INPUT_LABEL_MAX) ?? 'Untitled',
			source: input.source,
			micPref: trim(input.micPref, RIDER_MIC_PREF_MAX),
			phantom: input.phantom ?? false,
			stand: input.stand ?? ('none' as const),
			monitorMixUserId: input.monitorMixUserId ?? null,
			notes: trim(input.notes, RIDER_ITEM_NOTES_MAX),
			sortOrder: j
		}))
	);

	// Nine columns an element, ten an input — eight rows a statement keeps both
	// under D1's 100-parameter ceiling with room to spare.
	for (let i = 0; i < elementRows.length; i += 8) {
		await db.insert(riderElement).values(elementRows.slice(i, i + 8));
	}
	for (let i = 0; i < inputRows.length; i += 8) {
		await db.insert(riderInput).values(inputRows.slice(i, i + 8));
	}
}

/**
 * A member replacing their own corner.
 *
 * **Takes no owner argument.** The caller's id comes from the guard, for the
 * reason `updateMyBandMembership` states: keying a mutation on a caller-supplied
 * id when the guard already knows the row is how one member ends up editing
 * another.
 */
export async function saveOwnElements(
	groupId: string,
	callerUserId: string,
	elements: RiderElementDraft[]
) {
	assertSize(elements);
	const riderId = await ensureRider(groupId);
	await replaceElementsForOwner(riderId, callerUserId, elements);
	await touch(riderId);
}

/**
 * An owner or admin replacing somebody's corner — or the band's shared items,
 * which is what `ownerUserId: null` means.
 *
 * The guard that admits the caller lives in the remote function; what this
 * enforces is that the target is actually on the roster, so an admin cannot
 * park gear on a stranger.
 */
export async function saveElementsFor(
	groupId: string,
	ownerUserId: string | null,
	elements: RiderElementDraft[]
) {
	assertSize(elements);
	if (ownerUserId) {
		const [member] = await db
			.select({ id: groupMember.id })
			.from(groupMember)
			.where(
				and(
					eq(groupMember.groupId, groupId),
					eq(groupMember.userId, ownerUserId),
					eq(groupMember.status, 'active')
				)
			)
			.limit(1);
		if (!member) throw new RiderTooLargeError('That person is not on this roster.');
	}
	const riderId = await ensureRider(groupId);
	await replaceElementsForOwner(riderId, ownerUserId, elements);
	await touch(riderId);
}

export interface RiderSettingsDraft {
	techContactUserId?: string | null;
	monitorFormat?: RiderMonitorFormat | null;
	notes?: string | null;
}

/** The band-level half: tech contact, monitor format, and the notes field. */
export async function saveRiderSettings(groupId: string, settings: RiderSettingsDraft) {
	const riderId = await ensureRider(groupId);
	await db
		.update(rider)
		.set({
			techContactUserId: settings.techContactUserId ?? null,
			monitorFormat: settings.monitorFormat ?? null,
			notes: trim(settings.notes, RIDER_NOTES_MAX),
			updatedAt: new Date()
		})
		.where(eq(rider.id, riderId));
}

async function touch(riderId: string) {
	await db.update(rider).set({ updatedAt: new Date() }).where(eq(rider.id, riderId));
}

export interface EventRiderSummary {
	/**
	 * The `event_band` row id.
	 *
	 * Carried because **a name is not unique on a bill**: an unlinked credit and
	 * a linked one can name the same act, and a band can legitimately play twice.
	 * Keying a list on the name throws `each_key_duplicate` and takes the whole
	 * advance page down with it, which is exactly what happened.
	 */
	id: string;
	/** The credit as it appears on the bill, which is not always a CMC band. */
	name: string;
	/** Null for an external act — there is no rider to link to. */
	slug: string | null;
	channelCount: number;
	phantomCount: number;
	venueProvidedCount: number;
	/** How many files the act uploaded instead of, or beside, filling this in. */
	uploadCount: number;
	/** Nothing at all: neither structured rows nor a file. Somebody has to ask. */
	empty: boolean;
}

/**
 * What each act on a bill has told us it needs — the advance question, answered
 * for a whole night at once.
 *
 * Hung off `event_band` rather than off `production_slot`, which does not exist:
 * the credit row already names the act, already distinguishes a linked CMC band
 * from a bare name, and is already what an advance walks down.
 *
 * Counts rather than the rider itself, because this is a card on a page about a
 * show. `empty` is the one an advance actually acts on — an act with neither
 * rows nor a file is one somebody has to go and ask.
 */
export async function getEventRiderSummaries(eventId: string): Promise<EventRiderSummary[]> {
	const rows = await db
		.select({
			id: eventBand.id,
			name: eventBand.name,
			billingOrder: eventBand.billingOrder,
			groupId: directoryEntry.groupId,
			slug: group.slug
		})
		.from(eventBand)
		.leftJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
		.leftJoin(group, eq(group.id, directoryEntry.groupId))
		.where(eq(eventBand.eventId, eventId))
		.orderBy(asc(eventBand.billingOrder));

	const groupIds = rows.map((r) => r.groupId).filter((id): id is string => !!id);
	if (groupIds.length === 0) {
		return rows.map((r) => ({
			id: r.id,
			name: r.name,
			slug: null,
			channelCount: 0,
			phantomCount: 0,
			venueProvidedCount: 0,
			uploadCount: 0,
			empty: true
		}));
	}

	// One aggregate over the whole bill rather than `getRider` per act: an advance
	// reads this for every act at once, and five acts would otherwise be fifteen
	// round trips.
	const counts = await db
		.select({
			groupId: rider.groupId,
			channelCount: sql<number>`count(${riderInput.id})`.as('channel_count'),
			phantomCount: sql<number>`sum(case when ${riderInput.phantom} then 1 else 0 end)`.as(
				'phantom_count'
			)
		})
		.from(rider)
		.leftJoin(riderElement, eq(riderElement.riderId, rider.id))
		.leftJoin(riderInput, eq(riderInput.elementId, riderElement.id))
		.where(inArray(rider.groupId, groupIds))
		.groupBy(rider.groupId);

	const venueCounts = await db
		.select({
			groupId: rider.groupId,
			n: sql<number>`count(${riderElement.id})`.as('n')
		})
		.from(rider)
		.innerJoin(riderElement, eq(riderElement.riderId, rider.id))
		.where(and(inArray(rider.groupId, groupIds), eq(riderElement.providedBy, 'venue')))
		.groupBy(rider.groupId);

	const uploads = await db
		.select({
			groupId: mediaAttachment.attachableId,
			n: sql<number>`count(*)`.as('n')
		})
		.from(mediaAttachment)
		.where(
			and(
				eq(mediaAttachment.attachableType, 'group'),
				inArray(mediaAttachment.attachableId, groupIds),
				inArray(mediaAttachment.slot, ['rider', 'stage_plot'])
			)
		)
		.groupBy(mediaAttachment.attachableId);

	const byGroup = new Map(counts.map((c) => [c.groupId, c]));
	const venueByGroup = new Map(venueCounts.map((c) => [c.groupId, Number(c.n)]));
	const uploadsByGroup = new Map(uploads.map((c) => [c.groupId, Number(c.n)]));

	return rows.map((row) => {
		const count = row.groupId ? byGroup.get(row.groupId) : undefined;
		const channelCount = Number(count?.channelCount ?? 0);
		const uploadCount = row.groupId ? (uploadsByGroup.get(row.groupId) ?? 0) : 0;
		return {
			id: row.id,
			name: row.name,
			slug: row.slug ?? null,
			channelCount,
			phantomCount: Number(count?.phantomCount ?? 0),
			venueProvidedCount: row.groupId ? (venueByGroup.get(row.groupId) ?? 0) : 0,
			uploadCount,
			empty: channelCount === 0 && uploadCount === 0
		};
	});
}

/** Percent of the stage. A client can post anything; this is where the bound lives. */
export function clampCoord(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.min(100, Math.max(0, Math.round(n)));
}

export interface RiderPlacement {
	elementId: string;
	/** Null unplaces it — back to the tray, which is a thing people do. */
	x: number | null;
	y: number | null;
}

/**
 * Move things around the stage.
 *
 * **Same ownership rule as the rest of the rider, enforced per element rather
 * than by the guard alone.** A member may place their own gear — positioning
 * your amp is part of saying what your amp needs — and an owner or admin may
 * place anything, including the band's shared kit. The UI only offers what the
 * caller may move, so a rejection here means a forged payload, and it throws
 * rather than skipping: silently dropping half a save would leave the plot
 * disagreeing with the screen it was dragged on.
 */
export async function savePlacements(
	groupId: string,
	caller: { userId: string; isAdmin: boolean },
	placements: RiderPlacement[]
) {
	if (placements.length === 0) return;

	const head = await findRider(groupId);
	if (!head) throw new RiderNotPlaceableError('This band has no rider yet.');

	const owned = await db
		.select({ id: riderElement.id, userId: riderElement.userId })
		.from(riderElement)
		.where(
			and(
				eq(riderElement.riderId, head.id),
				inArray(
					riderElement.id,
					placements.map((p) => p.elementId)
				)
			)
		);

	const byId = new Map(owned.map((row) => [row.id, row]));

	for (const placement of placements) {
		const row = byId.get(placement.elementId);
		if (!row) throw new RiderNotPlaceableError('That item is not on this rider.');
		if (!caller.isAdmin && row.userId !== caller.userId) {
			throw new RiderNotPlaceableError('That is not your gear to move.');
		}
	}

	// One statement per element — a placement carries two columns, so even a
	// fully placed stage stays well inside D1's parameter ceiling, and a `case`
	// expression over sixty elements would be harder to read than the loop.
	for (const placement of placements) {
		await db
			.update(riderElement)
			.set({
				x: placement.x === null ? null : clampCoord(placement.x),
				y: placement.y === null ? null : clampCoord(placement.y)
			})
			.where(eq(riderElement.id, placement.elementId));
	}

	await touch(head.id);
}
