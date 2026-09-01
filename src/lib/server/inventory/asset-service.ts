import { db } from '$lib/server/db';
import {
	acquisition,
	equipmentCategory,
	inventoryAsset,
	inventoryItem,
	inventoryLocation
} from '$lib/server/db/schema/inventory';
import { and, asc, eq, isNotNull, isNull, like, notInArray, or } from 'drizzle-orm';
import { user } from '$lib/server/db/schema/authentication';
import { form8282Status, needsAttention } from './form-8282';
import { recordMovement } from './stock-service';
import type { AssetStatus, EquipmentCondition } from '$lib/config';

/**
 * One physical unit of a `serialized` item.
 *
 * The rule that shapes this file: **an asset's identity is the row, never the
 * sticker on it.** A tag is bound and can be rebound; a retired asset is never
 * deleted, because its history has to outlive it.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AssetNotFoundError extends Error {
	constructor() {
		super('Asset not found');
		this.name = 'AssetNotFoundError';
	}
}

export class AssetTagTakenError extends Error {
	constructor(tag: string) {
		super(`Tag '${tag}' is already bound to another asset`);
		this.name = 'AssetTagTakenError';
	}
}

export class NotSerializedError extends Error {
	constructor() {
		super('Only a serialized item can have individual assets');
		this.name = 'NotSerializedError';
	}
}

export class InvalidAssetTransitionError extends Error {
	constructor(from: string, to: string) {
		super(`Cannot transition asset from '${from}' to '${to}'`);
		this.name = 'InvalidAssetTransitionError';
	}
}

/**
 * `retired` and `lost` are terminal. Everything else can reach `in_service`
 * again, because gear comes back from the shop and turns up behind a cabinet.
 */
const TERMINAL_STATUSES: readonly AssetStatus[] = ['retired', 'lost'];

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface CreateAssetData {
	itemId: string;
	assetTag?: string;
	serialNumber?: string;
	condition: EquipmentCondition;
	locationId?: string;
	acquisitionId?: string;
	notes?: string;
	actorId?: string;
}

/**
 * Bring one unit into existence, and write the `receive` movement that says so.
 *
 * The movement is not optional bookkeeping: on-hand for a serialized item is the
 * ledger sum, so an asset created without one would be invisible to every
 * availability check.
 */
export async function createAsset(data: CreateAssetData) {
	const [item] = await db
		.select({ kind: inventoryItem.kind })
		.from(inventoryItem)
		.where(and(eq(inventoryItem.id, data.itemId), isNull(inventoryItem.deletedAt)))
		.limit(1);

	if (!item) throw new AssetNotFoundError();
	if (item.kind !== 'serialized') throw new NotSerializedError();

	if (data.assetTag) await assertTagFree(data.assetTag);

	const [row] = await db
		.insert(inventoryAsset)
		.values({
			itemId: data.itemId,
			assetTag: data.assetTag ?? null,
			serialNumber: data.serialNumber ?? null,
			condition: data.condition,
			status: 'in_service',
			locationId: data.locationId ?? null,
			acquisitionId: data.acquisitionId ?? null,
			notes: data.notes ?? null
		})
		.returning();

	await recordMovement({
		itemId: data.itemId,
		assetId: row.id,
		quantity: 1,
		reason: 'receive',
		locationId: data.locationId ?? null,
		acquisitionId: data.acquisitionId ?? null,
		actorId: data.actorId ?? null
	});

	return row;
}

async function assertTagFree(tag: string, exceptAssetId?: string) {
	const [existing] = await db
		.select({ id: inventoryAsset.id })
		.from(inventoryAsset)
		.where(eq(inventoryAsset.assetTag, tag))
		.limit(1);

	if (existing && existing.id !== exceptAssetId) throw new AssetTagTakenError(tag);
}

/**
 * Bind a printed tag to a unit.
 *
 * Rebinding is a normal event, not an error state: stickers come off amps. The
 * asset keeps its id, its history and its loans — only the label changes.
 */
export async function bindAssetTag(assetId: string, assetTag: string) {
	await assertTagFree(assetTag, assetId);

	const [row] = await db
		.update(inventoryAsset)
		.set({ assetTag, updatedAt: new Date() })
		.where(eq(inventoryAsset.id, assetId))
		.returning();

	if (!row) throw new AssetNotFoundError();
	return row;
}

export async function updateAsset(
	id: string,
	data: {
		serialNumber?: string;
		condition?: EquipmentCondition;
		locationId?: string | null;
		notes?: string;
	}
) {
	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.serialNumber !== undefined) updates.serialNumber = data.serialNumber || null;
	if (data.condition !== undefined) updates.condition = data.condition;
	if (data.locationId !== undefined) updates.locationId = data.locationId;
	if (data.notes !== undefined) updates.notes = data.notes || null;

	const [row] = await db
		.update(inventoryAsset)
		.set(updates)
		.where(eq(inventoryAsset.id, id))
		.returning();

	if (!row) throw new AssetNotFoundError();
	return row;
}

/**
 * Take a unit out of service, or bring it back.
 *
 * Both directions write a movement, which is what keeps on-hand honest: an amp
 * in the shop is still owned but is not stock, and the ledger is the only place
 * that distinction is recorded.
 */
export async function setAssetStatus(
	id: string,
	status: AssetStatus,
	opts: { notes?: string; condition?: EquipmentCondition; actorId?: string } = {}
) {
	const asset = await getAssetRaw(id);
	if (!asset) throw new AssetNotFoundError();

	if (TERMINAL_STATUSES.includes(asset.status)) {
		throw new InvalidAssetTransitionError(asset.status, status);
	}
	if (asset.status === status) return asset;

	const now = new Date();
	const updates: Record<string, unknown> = { status, updatedAt: now };
	if (opts.condition) updates.condition = opts.condition;
	if (status === 'retired' || status === 'lost') {
		updates.retiredAt = now;
		updates.retiredReason = opts.notes ?? null;
	}

	const [row] = await db
		.update(inventoryAsset)
		.set(updates)
		.where(eq(inventoryAsset.id, id))
		.returning();

	const reason = movementReasonForStatus(asset.status, status);
	if (reason) {
		await recordMovement({
			itemId: asset.itemId,
			assetId: id,
			quantity: 1,
			reason,
			locationId: asset.locationId,
			actorId: opts.actorId ?? null,
			notes: opts.notes ?? null
		});
	}

	return row;
}

/**
 * Which ledger entry a status change implies.
 *
 * `on_loan` is deliberately absent in both directions: the loan lifecycle writes
 * `loan_out`/`loan_return` itself, and writing one here too would decrement the
 * same amp twice.
 */
function movementReasonForStatus(from: AssetStatus, to: AssetStatus) {
	if (to === 'retired') return 'retire' as const;
	if (to === 'lost') return 'loss' as const;
	if (to === 'maintenance') return 'repair_out' as const;
	if (to === 'in_service' && from === 'maintenance') return 'repair_in' as const;
	return null;
}

// ---------------------------------------------------------------------------
// Form 8282
// ---------------------------------------------------------------------------

/**
 * Donated units that have been disposed of and may owe a Form 8282.
 *
 * The candidate set is narrowed in SQL — donated, disposed, unresolved — and the
 * three-year window is then applied in JS by `form8282Status`, so the rule lives
 * in exactly one place and stays testable as a table. The row count here is
 * small by construction: it is gear the collective was given and has since let
 * go of.
 *
 * Only gifts CMC signed a Form 8283 for can owe anything, so the rest come back
 * as a count. They are worth showing — "nothing outstanding" with no denominator
 * reads like a page that is not looking — without being dressed as obligations
 * they are not.
 */
export async function listForm8282Obligations(now = new Date()) {
	const rows = await db
		.select({
			asset: inventoryAsset,
			item: inventoryItem,
			acquiredAt: acquisition.occurredAt,
			donorUserName: user.name,
			sourceName: acquisition.sourceName,
			acknowledgedAt: acquisition.acknowledgedAt,
			fairValueCents: acquisition.fairValueCents
		})
		.from(inventoryAsset)
		.innerJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id))
		.innerJoin(acquisition, eq(inventoryAsset.acquisitionId, acquisition.id))
		// A donor may be a member or an outside party; `sourceName` carries the
		// latter. The copy of the form has to reach whoever it actually was.
		.leftJoin(user, eq(acquisition.donorUserId, user.id))
		.where(
			and(
				eq(acquisition.kind, 'donation'),
				isNotNull(inventoryAsset.retiredAt),
				isNull(inventoryAsset.form8282ResolvedAt)
			)
		);

	// Split rather than filtered in SQL: the unacknowledged ones are not an
	// obligation, but a bare "nothing outstanding" leaves a staffer wondering
	// whether anything is being watched at all. They are counted, not listed.
	const acknowledged = rows.filter((r) => r.acknowledgedAt !== null);

	const obligations = acknowledged
		.map((r) => ({
			...r.asset,
			item: r.item,
			acquiredAt: r.acquiredAt,
			donor: r.donorUserName ?? r.sourceName,
			acknowledgedAt: r.acknowledgedAt,
			fairValueCents: r.fairValueCents,
			status: form8282Status(
				{
					acquiredAt: r.acquiredAt,
					wasDonated: true,
					acknowledged: true,
					disposedAt: r.asset.retiredAt,
					resolvedAt: r.asset.form8282ResolvedAt
				},
				now
			)
		}))
		.filter((r) => needsAttention(r.status))
		// Soonest deadline first; anything already overdue sorts to the top.
		.sort((a, b) => (a.status.dueBy?.getTime() ?? 0) - (b.status.dueBy?.getTime() ?? 0));

	return { obligations, noFormOnRecord: rows.length - acknowledged.length };
}

/** Record that the filing was made, or that none was needed. */
export async function resolveForm8282(assetId: string, note: string) {
	const [row] = await db
		.update(inventoryAsset)
		.set({ form8282ResolvedAt: new Date(), form8282Note: note, updatedAt: new Date() })
		.where(eq(inventoryAsset.id, assetId))
		.returning();

	if (!row) throw new AssetNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function getAssetRaw(id: string) {
	const [row] = await db.select().from(inventoryAsset).where(eq(inventoryAsset.id, id)).limit(1);
	return row ?? null;
}

export async function getAssetById(id: string) {
	const [row] = await db
		.select({
			asset: inventoryAsset,
			item: inventoryItem,
			category: equipmentCategory,
			location: inventoryLocation
		})
		.from(inventoryAsset)
		.innerJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id))
		.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.leftJoin(inventoryLocation, eq(inventoryAsset.locationId, inventoryLocation.id))
		.where(eq(inventoryAsset.id, id))
		.limit(1);

	if (!row) return null;
	return { ...row.asset, item: row.item, category: row.category, location: row.location };
}

/** The lookup behind `/a/[tag]`. */
export async function getAssetByTag(tag: string) {
	const [row] = await db
		.select({ id: inventoryAsset.id })
		.from(inventoryAsset)
		.where(eq(inventoryAsset.assetTag, tag))
		.limit(1);

	if (!row) return null;
	return getAssetById(row.id);
}

export async function listAssets(opts: { itemId?: string; status?: AssetStatus; search?: string }) {
	const conditions = [];
	if (opts.itemId) conditions.push(eq(inventoryAsset.itemId, opts.itemId));
	if (opts.status) conditions.push(eq(inventoryAsset.status, opts.status));
	if (opts.search) {
		conditions.push(
			or(
				like(inventoryAsset.assetTag, `%${opts.search}%`),
				like(inventoryAsset.serialNumber, `%${opts.search}%`)
			)
		);
	}

	return db
		.select({ asset: inventoryAsset, item: inventoryItem, location: inventoryLocation })
		.from(inventoryAsset)
		.innerJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id))
		.leftJoin(inventoryLocation, eq(inventoryAsset.locationId, inventoryLocation.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(asc(inventoryItem.name), asc(inventoryAsset.assetTag))
		.then((rows) => rows.map((r) => ({ ...r.asset, item: r.item, location: r.location })));
}

/**
 * Units with no tag bound yet — the tagging backlog.
 *
 * Derived every time rather than stored: "needs tagging" is exactly
 * `asset_tag IS NULL`, and a stored flag would be a second source of truth that
 * `bindAssetTag` would have to remember to clear. Retired and lost units are
 * excluded because nobody is going to walk over and put a sticker on them.
 *
 * Oldest first: a stocktake enters gear faster than it labels it, so the
 * backlog is worked in the order it accumulated.
 */
export async function listUntaggedAssets(opts: { itemId?: string } = {}) {
	const conditions = [
		isNull(inventoryAsset.assetTag),
		notInArray(inventoryAsset.status, ['retired', 'lost'])
	];
	if (opts.itemId) conditions.push(eq(inventoryAsset.itemId, opts.itemId));

	return db
		.select({ asset: inventoryAsset, item: inventoryItem, location: inventoryLocation })
		.from(inventoryAsset)
		.innerJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id))
		.leftJoin(inventoryLocation, eq(inventoryAsset.locationId, inventoryLocation.id))
		.where(and(...conditions))
		.orderBy(asc(inventoryAsset.createdAt))
		.then((rows) => rows.map((r) => ({ ...r.asset, item: r.item, location: r.location })));
}

/** Units of an item that could be handed to someone right now. */
export async function listAvailableAssets(itemId: string) {
	return listAssets({ itemId, status: 'in_service' });
}
