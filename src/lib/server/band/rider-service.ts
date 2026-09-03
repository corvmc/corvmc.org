import { db } from '$lib/server/db';
import { rider, riderElement, riderInput } from '$lib/server/db/schema/rider';
import { groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
			ownerName: user.name,
			kind: riderElement.kind,
			label: riderElement.label,
			providedBy: riderElement.providedBy,
			notes: riderElement.notes,
			sortOrder: riderElement.sortOrder
		})
		.from(riderElement)
		.leftJoin(user, eq(user.id, riderElement.userId))
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
	const doomed = await db.select({ id: riderElement.id }).from(riderElement).where(ownerFilter);

	if (doomed.length) {
		await db.delete(riderElement).where(
			inArray(
				riderElement.id,
				doomed.map((d) => d.id)
			)
		);
	}

	if (!elements.length) return;

	const elementRows = elements.map((el, i) => ({
		id: crypto.randomUUID(),
		riderId,
		userId: ownerUserId,
		kind: el.kind,
		label: trim(el.label, RIDER_ELEMENT_LABEL_MAX) ?? 'Untitled',
		providedBy: el.providedBy ?? ('band' as const),
		notes: trim(el.notes, RIDER_ITEM_NOTES_MAX),
		sortOrder: i
	}));

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
