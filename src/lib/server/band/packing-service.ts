import { db } from '$lib/server/db';
import { packingItem, packingList } from '$lib/server/db/schema/packing';
import { groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
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
 * it is loaded yet.
 *
 * **Three separate concerns, three separate permission rules**, which is why
 * this module is longer than it looks:
 *
 * | Verb   | Who may                                                    | Lifetime     |
 * | ------ | ---------------------------------------------------------- | ------------ |
 * | edit   | the row's owner, or an admin                               | forever      |
 * | assign | anyone may claim an *unassigned* row for themselves or      | until        |
 * |        | release their own; an admin may assign or reassign anyone   | changed      |
 * | pack   | anyone on the roster, on any row                           | one trip     |
 *
 * The editing rule is the rider's, copied deliberately. The other two are not,
 * and both departures are load-bearing: one person walks the list at load-out
 * and it is not reliably an admin, and "I'll bring the PA" is how a band
 * actually settles this — not by the owner filing a request.
 *
 * **Takes-no-argument is how each rule is enforced, not a role check.**
 * `saveOwnItems` and `claimItem` take no owner and no assignee respectively;
 * they write the caller the guard already resolved. `saveItemsFor` and
 * `assignItem` are the separate admin-guarded paths that name somebody. Two (or
 * three) functions rather than one with a flag, because the flag is the thing
 * that gets passed wrong.
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
	promotedAt: Date | null;
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
 * The order the list reads in: category first, then the owner's own tie-break,
 * then the label.
 *
 * **Category, not `sortOrder`** — the same split, for the same reason,
 * `compareElements` makes on a rider element's `kind`. `sortOrder` is dense
 * *within one owner's rows*, so two members who both have a row at position 0
 * would otherwise interleave by whoever saved last.
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

	const items = [...rows].sort(compareItems);

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
 * This is the one place the rider's precedent does not transfer.
 * `replaceElementsForOwner` deletes an owner's elements and reinserts them,
 * which is right when the payload is the whole truth — a rider element holds
 * nothing but what the member typed. A packing item holds `packed`,
 * `assignedUserId` and `promotedAt`: state nobody typed and nobody can retype.
 * Delete-and-reinsert would unpack the van and drop whoever agreed to carry the
 * box every time somebody fixed a spelling.
 *
 * So: ids in, and three kinds of statement out. Scoped by
 * `(listId, ownerUserId)` exactly as the rider's is, which is what makes the
 * client-supplied ids safe — an id the owner filter did not return is
 * **rejected, never adopted**, so a forged payload cannot reach into another
 * member's crate or another band's list.
 *
 * `sortOrder` is still re-derived from array position, so no client can post an
 * order.
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
 * **Takes no assignee**, so there is no code path by which a member could put a
 * row on somebody else — the same shape, for the same reason, as
 * `saveOwnItems`.
 *
 * The write carries its own `assigned_user_id IS NULL` predicate and reports
 * zero affected rows as `PackingAlreadyClaimedError`, rather than reading and
 * then writing. Two people tapping "I'll bring it" on the PA at the same moment
 * is the realistic case here, not an edge one, and a read-then-write lets the
 * second silently overwrite the first. It is expected rather than exceptional:
 * the page's answer is "Sam already has this one", not a failure.
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
 * against ownership or against the assignment: one person walks the list at
 * load-out and it is not reliably the owner of everything in the van. See the
 * `packed` column comment; this is the rule a later reader would "fix" back to
 * the rider's.
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
 * **Ticks only. Assignments survive.** Who is bringing the PA is not a per-trip
 * fact, and a reset that cleared it too would make the band re-negotiate the
 * load-in from scratch every show — which is the coordination this feature
 * exists to remove. Two verbs, two lifetimes.
 *
 * `db.batch`, never `db.transaction` — the latter is broken on D1 and ESLint
 * errors on it. The parameter count is constant however long the list is, so
 * this is the one write here that the 100-parameter cap has no opinion about.
 * The `packed = true` filter is not an optimisation: it is what lets
 * `idx_packing_item_packed` do the work, and it keeps a no-op reset from
 * rewriting a hundred rows.
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

/** Bumped by edits to what the band brings — never by a tick or a claim. */
async function touch(listId: string) {
	await db.update(packingList).set({ updatedAt: new Date() }).where(eq(packingList.id, listId));
}
