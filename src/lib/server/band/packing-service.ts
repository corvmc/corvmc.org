import { db } from '$lib/server/db';
import { packingItem, packingList } from '$lib/server/db/schema/packing';
import { groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { rider, riderElement } from '$lib/server/db/schema/rider';
import { appendOwnElements } from './rider-service';
import { aliasedTable, and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import {
	packingCategories,
	PACKING_ITEM_NOTES_MAX,
	PACKING_LABEL_MAX,
	PACKING_MAX_ITEMS,
	PACKING_MAX_QUANTITY,
	PACKING_NOTES_MAX,
	type PackingCategory,
	type RiderElementKind
} from '$lib/config';

/**
 * A band's packing list — what goes in the van, who is bringing it, and whether
 * it is loaded yet. Three concerns, three permission rules.
 *
 * **Takes-no-argument enforces each rule, not a role check** — `saveOwnItems`
 * takes no owner and `claimItem` no assignee, because the flag is the thing
 * that gets passed wrong. Rationale: docs/specs/packing-list-spec.md
 */

/** More things than any real band's van, and than one payload should carry. */
export class PackingTooLargeError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'PackingTooLargeError';
	}
}

/** A draft or an id naming a row that is not on this list, or not this owner's. */
export class PackingItemNotFoundError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'PackingItemNotFoundError';
	}
}

/** A first-aid kit and a box of shirts are not stage gear — see `rider_kind`. */
export class PackingNotPromotableError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'PackingNotPromotableError';
	}
}

/** Somebody else claimed it first. Expected, not exceptional — see `claimItem`. */
export class PackingAlreadyClaimedError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'PackingAlreadyClaimedError';
	}
}

export interface PackingItemView {
	id: string;
	/** Whose gear it is. Null is the band's own. */
	userId: string | null;
	ownerName: string | null;
	/** Who is carrying it. Null is "nobody has this" — never the same fact as `userId`. */
	assignedUserId: string | null;
	assignedName: string | null;
	assignedAt: Date | null;
	category: PackingCategory;
	label: string;
	quantity: number;
	riderKind: RiderElementKind | null;
	notes: string | null;
	sortOrder: number;
	packed: boolean;
	packedAt: Date | null;
	packedByName: string | null;
	/** That the band decided to promote it. Never whether it is there now. */
	promotedAt: Date | null;
	/**
	 * Whether an element with this owner and label is on the rider **now**.
	 *
	 * Computed, not stored: `promotedAt` would say yes forever, so a member who
	 * promoted something and then deliberately deleted it would be nagged to
	 * promote it again on every load. The pair is the whole point of having both.
	 */
	onRider: boolean;
}

export interface PackingListView {
	/** Null until somebody saves something — an unstarted list is not a row. */
	id: string | null;
	groupId: string;
	notes: string | null;
	lastResetAt: Date | null;
	lastResetByName: string | null;
	updatedAt: Date | null;
	items: PackingItemView[];
	itemCount: number;
	packedCount: number;
	/**
	 * Rows nobody has agreed to bring. Listed before the packed count everywhere
	 * it is shown: an unassigned row is the one that gets left behind, and it is
	 * actionable days before load-in while a packed count only means something
	 * during it.
	 */
	unassignedCount: number;
}

export interface PackingItemDraft {
	/** Present on a row that already exists. See `types/packing.ts` for why. */
	id?: string;
	category: PackingCategory;
	label: string;
	quantity?: number;
	riderKind?: RiderElementKind | null;
	notes?: string | null;
}

export interface PackingSettingsDraft {
	notes?: string | null;
}

const categoryRank = new Map(packingCategories.map((c, i) => [c, i]));

/**
 * The order the list reads in: category, then the owner's tie-break, then label.
 *
 * **Category, not `sortOrder`.** `sortOrder` is dense *within one owner's rows*,
 * so two members each holding position 0 would otherwise interleave by whoever
 * saved last. See the spec's "ordering comes from category".
 */
export function compareItems(
	a: Pick<PackingItemView, 'category' | 'sortOrder' | 'label'>,
	b: Pick<PackingItemView, 'category' | 'sortOrder' | 'label'>
): number {
	const byCategory = (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99);
	if (byCategory !== 0) return byCategory;
	if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
	return a.label.localeCompare(b.label);
}

function trim(value: string | null | undefined, max: number): string | null {
	const v = value?.trim();
	if (!v) return null;
	return v.length > max ? v.slice(0, max) : v;
}

function clampQuantity(n: number | null | undefined): number {
	if (!n || !Number.isFinite(n)) return 1;
	return Math.min(PACKING_MAX_QUANTITY, Math.max(1, Math.trunc(n)));
}

/** Runs before any query, so an oversized payload costs no round trips. */
function assertSize(items: PackingItemDraft[]) {
	if (items.length > PACKING_MAX_ITEMS) {
		throw new PackingTooLargeError(`A packing list can hold at most ${PACKING_MAX_ITEMS} things.`);
	}
}

/** The list row for a band, or null. Creates nothing — reads must not write. */
export async function findPackingList(groupId: string) {
	const rows = await db.select().from(packingList).where(eq(packingList.groupId, groupId)).limit(1);
	return rows[0] ?? null;
}

/**
 * The list row, created if this is the band's first save.
 *
 * Racy in principle — two members saving at the same instant could both miss
 * the select — which is what `uq_packing_list_group` is for: the loser's insert
 * fails and the retry finds the winner's row.
 */
export async function ensurePackingList(groupId: string): Promise<string> {
	const existing = await findPackingList(groupId);
	if (existing) return existing.id;
	try {
		const [created] = await db
			.insert(packingList)
			.values({ groupId })
			.returning({ id: packingList.id });
		return created.id;
	} catch {
		const retry = await findPackingList(groupId);
		if (retry) return retry.id;
		throw new Error('Could not create packing list');
	}
}

/** The whole list, ordered, with every name resolved for display. */
export async function getPackingList(groupId: string): Promise<PackingListView> {
	const head = await findPackingList(groupId);

	const view: PackingListView = {
		id: head?.id ?? null,
		groupId,
		notes: head?.notes ?? null,
		lastResetAt: head?.lastResetAt ?? null,
		lastResetByName: null,
		updatedAt: head?.updatedAt ?? null,
		items: [],
		itemCount: 0,
		packedCount: 0,
		unassignedCount: 0
	};
	if (!head) return view;

	if (head.lastResetByUserId) {
		const [row] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, head.lastResetByUserId))
			.limit(1);
		view.lastResetByName = row?.name ?? null;
	}

	// Three aliased joins to `user` on one row — whose it is, who is carrying it,
	// who ticked it. `ownerName` and `assignedName` coalesce through
	// `group_member.alias` the way `getRider` does, because the band's word for
	// who somebody is has to agree across every page that names them;
	// `packedByName` does not, since it is an audit line rather than a roster
	// position.
	const owner = aliasedTable(user, 'owner_user');
	const assignee = aliasedTable(user, 'assigned_user');
	const packer = aliasedTable(user, 'packed_by_user');
	const ownerMember = aliasedTable(groupMember, 'owner_member');
	const assigneeMember = aliasedTable(groupMember, 'assigned_member');

	const rows = await db
		.select({
			id: packingItem.id,
			userId: packingItem.userId,
			ownerName: sql<string | null>`coalesce(${ownerMember.alias}, ${owner.name})`.as('owner_name'),
			assignedUserId: packingItem.assignedUserId,
			assignedName: sql<string | null>`coalesce(${assigneeMember.alias}, ${assignee.name})`.as(
				'assigned_name'
			),
			assignedAt: packingItem.assignedAt,
			category: packingItem.category,
			label: packingItem.label,
			quantity: packingItem.quantity,
			riderKind: packingItem.riderKind,
			notes: packingItem.notes,
			sortOrder: packingItem.sortOrder,
			packed: packingItem.packed,
			packedAt: packingItem.packedAt,
			packedByName: packer.name,
			promotedAt: packingItem.promotedAt
		})
		.from(packingItem)
		.leftJoin(owner, eq(owner.id, packingItem.userId))
		.leftJoin(
			ownerMember,
			and(eq(ownerMember.groupId, groupId), eq(ownerMember.userId, packingItem.userId))
		)
		.leftJoin(assignee, eq(assignee.id, packingItem.assignedUserId))
		.leftJoin(
			assigneeMember,
			and(
				eq(assigneeMember.groupId, groupId),
				eq(assigneeMember.userId, packingItem.assignedUserId)
			)
		)
		.leftJoin(packer, eq(packer.id, packingItem.packedByUserId))
		.where(eq(packingItem.listId, head.id))
		.orderBy(asc(packingItem.sortOrder));

	// The live "is it on the rider" answer, by `(owner, label)`. One extra read
	// rather than a join, because a row with no `riderKind` can never match and
	// most rows have none. `promotedAt` is the decision; this is the state.
	const onRider = await db
		.select({ userId: riderElement.userId, label: riderElement.label })
		.from(riderElement)
		.innerJoin(rider, eq(rider.id, riderElement.riderId))
		.where(eq(rider.groupId, groupId));

	const key = (userId: string | null, label: string) => `${userId ?? ''} ${label}`;
	const onRiderKeys = new Set(onRider.map((e) => key(e.userId, e.label)));

	const items = [...rows]
		.map((row) => ({ ...row, onRider: onRiderKeys.has(key(row.userId, row.label)) }))
		.sort(compareItems);

	return {
		...view,
		items,
		itemCount: items.length,
		packedCount: items.filter((i) => i.packed).length,
		unassignedCount: items.filter((i) => i.assignedUserId === null).length
	};
}

/**
 * Apply one owner's submitted rows as a **diff**, not a replacement.
 *
 * A packing item holds `packed`, `assignedUserId` and `promotedAt` — state
 * nobody typed — so a rebuild would unpack the van on every spelling fix. Ids
 * are scoped by `(listId, ownerUserId)`; one the filter did not return is
 * rejected, never adopted. See the spec's "the save is a diff".
 */
async function applyItemsForOwner(
	listId: string,
	ownerUserId: string | null,
	drafts: PackingItemDraft[]
) {
	const ownerFilter = ownerUserId
		? and(eq(packingItem.listId, listId), eq(packingItem.userId, ownerUserId))
		: and(eq(packingItem.listId, listId), isNull(packingItem.userId));

	const existing = await db.select({ id: packingItem.id }).from(packingItem).where(ownerFilter);
	const existingIds = new Set(existing.map((e) => e.id));

	for (const draft of drafts) {
		if (draft.id && !existingIds.has(draft.id)) {
			throw new PackingItemNotFoundError('That item is not on this list.');
		}
	}

	const kept = new Set(drafts.map((d) => d.id).filter((id): id is string => !!id));
	const gone = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
	if (gone.length) {
		await db.delete(packingItem).where(inArray(packingItem.id, gone));
	}

	const fresh: (typeof packingItem.$inferInsert)[] = [];

	for (const [i, draft] of drafts.entries()) {
		const values = {
			category: draft.category,
			label: trim(draft.label, PACKING_LABEL_MAX) ?? 'Untitled',
			quantity: clampQuantity(draft.quantity),
			riderKind: draft.riderKind ?? null,
			notes: trim(draft.notes, PACKING_ITEM_NOTES_MAX),
			sortOrder: i
		};

		if (draft.id) {
			// **Six keys, and the omissions are the point.** `packed`, `packedAt`,
			// `packedByUserId`, `assignedUserId`, `assignedAt`, `assignedByUserId`,
			// `promotedAt`, `userId` and `listId` are all absent on purpose: editing
			// what a thing *is* must not unpack it, un-delegate it, or move it to
			// another owner. A stray key here is the bug this whole diff exists to
			// prevent, which is why the spec asserts on the payload's keys and not
			// just on its values.
			await db.update(packingItem).set(values).where(eq(packingItem.id, draft.id));
		} else {
			fresh.push({ ...values, listId, userId: ownerUserId });
		}
	}

	// Eight bound columns a row — the six above plus `listId` and `userId`, with
	// the rest defaulted — so ten rows a statement stays well under D1's
	// 100-parameter ceiling.
	for (let i = 0; i < fresh.length; i += 10) {
		await db.insert(packingItem).values(fresh.slice(i, i + 10));
	}
}

/** Throws unless `userId` is an active member of the band. */
async function assertActiveMember(groupId: string, userId: string) {
	const [member] = await db
		.select({ id: groupMember.id })
		.from(groupMember)
		.where(
			and(
				eq(groupMember.groupId, groupId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active')
			)
		)
		.limit(1);
	if (!member) throw new PackingItemNotFoundError('That person is not on this roster.');
}

/**
 * A member replacing their own rows.
 *
 * **Takes no owner argument**, for the reason `saveOwnElements` states.
 */
export async function saveOwnItems(
	groupId: string,
	callerUserId: string,
	items: PackingItemDraft[]
) {
	assertSize(items);
	const listId = await ensurePackingList(groupId);
	await applyItemsForOwner(listId, callerUserId, items);
	await touch(listId);
}

/**
 * An owner or admin replacing somebody's rows — or the band's shared crate,
 * which is what `ownerUserId: null` means.
 *
 * The guard admitting the caller lives in the remote function; what this
 * enforces is that the target is on the roster, so an admin cannot park a crate
 * on a stranger.
 */
export async function saveItemsFor(
	groupId: string,
	ownerUserId: string | null,
	items: PackingItemDraft[]
) {
	assertSize(items);
	if (ownerUserId) await assertActiveMember(groupId, ownerUserId);
	const listId = await ensurePackingList(groupId);
	await applyItemsForOwner(listId, ownerUserId, items);
	await touch(listId);
}

/** The band-level half: the notes nobody outside the band reads. */
export async function savePackingSettings(groupId: string, settings: PackingSettingsDraft) {
	const listId = await ensurePackingList(groupId);
	await db
		.update(packingList)
		.set({ notes: trim(settings.notes, PACKING_NOTES_MAX), updatedAt: new Date() })
		.where(eq(packingList.id, listId));
}

/** Resolve one row on this band's list, or throw. */
async function requireItem(groupId: string, itemId: string) {
	const head = await findPackingList(groupId);
	if (!head) throw new PackingItemNotFoundError('That item is not on this list.');
	const [row] = await db
		.select()
		.from(packingItem)
		.where(and(eq(packingItem.id, itemId), eq(packingItem.listId, head.id)))
		.limit(1);
	if (!row) throw new PackingItemNotFoundError('That item is not on this list.');
	return { head, row };
}

/**
 * A member taking responsibility for an unclaimed row.
 *
 * **Takes no assignee**, so no code path puts a row on somebody else. The write
 * carries its own `assigned_user_id IS NULL` predicate and reports zero rows as
 * `PackingAlreadyClaimedError` — expected, not exceptional, because a
 * read-then-write loses the first claim. Spec: "claimItem is a conditional write".
 */
export async function claimItem(groupId: string, callerUserId: string, itemId: string) {
	const { head } = await requireItem(groupId, itemId);
	const claimed = await db
		.update(packingItem)
		.set({
			assignedUserId: callerUserId,
			assignedAt: new Date(),
			assignedByUserId: callerUserId
		})
		.where(
			and(
				eq(packingItem.id, itemId),
				eq(packingItem.listId, head.id),
				isNull(packingItem.assignedUserId)
			)
		)
		.returning({ id: packingItem.id });

	if (!claimed.length) {
		throw new PackingAlreadyClaimedError('Somebody else is already bringing that.');
	}
	// Deliberately no `touch()` — see `packing_item.assigned_user_id`. Who is
	// carrying a thing is not a change to what the band brings, and bumping
	// `updatedAt` here would remount every open editor on the page.
}

/**
 * A member handing back a row they had claimed.
 *
 * Scoped to the caller's own assignment. Releasing somebody else's is the admin
 * path, and it goes through `assignItem(…, null)`.
 */
export async function releaseItem(groupId: string, callerUserId: string, itemId: string) {
	const { head } = await requireItem(groupId, itemId);
	const released = await db
		.update(packingItem)
		.set({ assignedUserId: null, assignedAt: null, assignedByUserId: null })
		.where(
			and(
				eq(packingItem.id, itemId),
				eq(packingItem.listId, head.id),
				eq(packingItem.assignedUserId, callerUserId)
			)
		)
		.returning({ id: packingItem.id });

	if (!released.length) {
		throw new PackingItemNotFoundError('You are not down to bring that one.');
	}
}

/**
 * An owner or admin putting a row on somebody, or taking it off them.
 *
 * `toUserId: null` unassigns. The target must be an active member, so a
 * departed member cannot be handed the PA.
 */
export async function assignItem(
	groupId: string,
	assignerUserId: string,
	itemId: string,
	toUserId: string | null
) {
	const { head } = await requireItem(groupId, itemId);
	if (toUserId) await assertActiveMember(groupId, toUserId);

	await db
		.update(packingItem)
		.set(
			toUserId
				? { assignedUserId: toUserId, assignedAt: new Date(), assignedByUserId: assignerUserId }
				: { assignedUserId: null, assignedAt: null, assignedByUserId: null }
		)
		.where(and(eq(packingItem.id, itemId), eq(packingItem.listId, head.id)));
}

/**
 * Tick or untick one row.
 *
 * **Any active member, any row.** `callerUserId` is recorded, not checked
 * against ownership or assignment: one person walks the list at load-out and is
 * not reliably the owner of everything in the van. A later reader would "fix"
 * this back to the rider's rule — see the `packed` column comment.
 */
export async function setPacked(
	groupId: string,
	callerUserId: string,
	itemId: string,
	packed: boolean
) {
	const { head } = await requireItem(groupId, itemId);
	await db
		.update(packingItem)
		.set(
			packed
				? { packed: true, packedAt: new Date(), packedByUserId: callerUserId }
				: { packed: false, packedAt: null, packedByUserId: null }
		)
		.where(and(eq(packingItem.id, itemId), eq(packingItem.listId, head.id)));
	// No `touch()`, for the same reason `claimItem` does not.
}

/**
 * Clear every tick for the next load-in.
 *
 * **Ticks only. Assignments survive** — two verbs, two lifetimes. `db.batch`,
 * never `db.transaction`, which is broken on D1. The `packed = true` filter is
 * not an optimisation: it lets `idx_packing_item_packed` do the work and keeps
 * a no-op reset from rewriting a hundred rows.
 */
export async function resetPacked(
	groupId: string,
	callerUserId: string
): Promise<{ cleared: number }> {
	const head = await findPackingList(groupId);
	if (!head) return { cleared: 0 };

	const [cleared] = await db.batch([
		db
			.update(packingItem)
			.set({ packed: false, packedAt: null, packedByUserId: null })
			.where(and(eq(packingItem.listId, head.id), eq(packingItem.packed, true)))
			.returning({ id: packingItem.id }),
		db
			.update(packingList)
			.set({ lastResetAt: new Date(), lastResetByUserId: callerUserId })
			.where(eq(packingList.id, head.id))
	]);

	return { cleared: cleared.length };
}

/**
 * Copy the caller's own rows onto the tech rider.
 *
 * **Takes no owner**, like every other own-rows verb here. `promotedAt` is
 * stamped whether or not anything was added, because it records that the band
 * made the decision — the live "is it there" answer is the label match
 * `getPackingList` computes on read. Rationale: docs/specs/packing-list-spec.md
 */
export async function promoteOwnItems(
	groupId: string,
	callerUserId: string,
	itemIds: string[]
): Promise<{ promoted: number; added: number }> {
	if (itemIds.length === 0) return { promoted: 0, added: 0 };

	const head = await findPackingList(groupId);
	if (!head) throw new PackingItemNotFoundError('That item is not on this list.');

	const rows = await db
		.select({
			id: packingItem.id,
			label: packingItem.label,
			riderKind: packingItem.riderKind,
			notes: packingItem.notes
		})
		.from(packingItem)
		.where(
			and(
				eq(packingItem.listId, head.id),
				eq(packingItem.userId, callerUserId),
				inArray(packingItem.id, itemIds)
			)
		);

	// Scoped by `(listId, userId)` like the diff: an id the filter did not
	// return is rejected, never adopted, so no payload promotes another
	// member's gear onto the rider under their name.
	if (rows.length !== itemIds.length) {
		throw new PackingItemNotFoundError('That item is not on this list.');
	}

	if (rows.some((r) => !r.riderKind)) {
		throw new PackingNotPromotableError('That one never stands on a stage.');
	}

	const { added } = await appendOwnElements(
		groupId,
		callerUserId,
		rows.map((r) => ({
			kind: r.riderKind as RiderElementKind,
			label: r.label,
			notes: r.notes
		}))
	);

	await db
		.update(packingItem)
		.set({ promotedAt: new Date() })
		.where(inArray(packingItem.id, itemIds));

	return { promoted: rows.length, added };
}

/** Bumped by edits to what the band brings — never by a tick or a claim. */
async function touch(listId: string) {
	await db.update(packingList).set({ updatedAt: new Date() }).where(eq(packingList.id, listId));
}
