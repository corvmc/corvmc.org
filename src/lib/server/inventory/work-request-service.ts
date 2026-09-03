import { db } from '$lib/server/db';
import { workRequest, inventoryAsset, inventoryItem } from '$lib/server/db/schema/inventory';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AssetNotFoundError, setAssetStatus } from './asset-service';
import type { EquipmentCondition } from '$lib/config';

/**
 * Flags: what somebody noticed about one unit.
 *
 * The split this module exists to make is between an **observation** and a
 * **state change**. Before it, `reportDamage` was both at once — the report *was*
 * the status flip — which is why a second reporter got an error, why only the
 * first was ever attributable, and why "it works, but the tolex is torn" had
 * nowhere to go.
 *
 * The ledger is untouched and still records what happened to the asset. It just
 * cannot record this: a `stock_movement` has to move something, so it can say
 * "went out for repair" but not "three people noticed" or "noticed, still
 * usable".
 */

export class AssetNotFlaggableError extends Error {
	constructor() {
		super('This unit has been retired or written off, so there is nothing to report against.');
		this.name = 'AssetNotFlaggableError';
	}
}

export class FlagNotFoundError extends Error {
	constructor() {
		super('That report no longer exists');
		this.name = 'FlagNotFoundError';
	}
}

export interface RaiseFlagInput {
	assetId: string;
	note: string;
	reportedByUserId: string;
	/**
	 * Whether the thing is unusable as it stands. This is the reporter's answer
	 * to "can it still be used?", not a severity score.
	 */
	blocksUse: boolean;
	/** How bad, when they were willing to say. "Not sure" is null. */
	condition?: EquipmentCondition | null;
	/** Set when raised at re-uptake, linking it to the loan it came back from. */
	loanId?: string | null;
}

/**
 * Record what somebody saw, and take the unit out of service only if that is
 * both warranted and ours to do.
 *
 * `maintenance` means **in our possession and not rentable** — it is not a third
 * custody state. So:
 *
 * - `in_service` + blocking → `maintenance`. It is ours, and it should not go
 *   out. This is the safety case the old immediate-pull behaviour existed for,
 *   preserved exactly where it applies.
 * - `on_loan` + anything → **no status change**. Noticing a crackle does not
 *   hand the amp back to the collective; it is still in somebody's car. It
 *   becomes `maintenance` on return, decided from the open blocking flags.
 * - non-blocking → no status change, whatever the custody. A soap dispenser does
 *   not close the bathroom.
 *
 * The flag is written first. If the status write then fails, the observation
 * still survives and staff can act on it — the reverse would lose the report
 * and leave a mystery status behind.
 */
export async function raiseFlag(input: RaiseFlagInput) {
	const [asset] = await db
		.select()
		.from(inventoryAsset)
		.where(eq(inventoryAsset.id, input.assetId))
		.limit(1);
	if (!asset) throw new AssetNotFoundError();

	// Terminal only. An already-flagged or in-the-shop unit accepts more reports:
	// the second person to notice is data, not an error, and telling them "known
	// issue" needs their row to exist.
	if (asset.status === 'retired' || asset.status === 'lost') {
		throw new AssetNotFlaggableError();
	}

	const now = new Date();
	const [flag] = await db
		.insert(workRequest)
		.values({
			assetId: asset.id,
			note: input.note,
			reportedByUserId: input.reportedByUserId,
			blocksUse: input.blocksUse,
			condition: input.condition ?? null,
			loanId: input.loanId ?? null,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	if (input.blocksUse && asset.status === 'in_service') {
		// Through the single writer, so the `repair_out` movement is derived from
		// the transition rather than written by hand here.
		await setAssetStatus(asset.id, 'maintenance', {
			notes: input.note,
			condition: input.condition ?? undefined,
			actorId: input.reportedByUserId
		});
	}

	return flag;
}

/** Whether anything open says this unit must not go out. */
export async function hasBlockingFlag(assetId: string): Promise<boolean> {
	const [row] = await db
		.select({ n: count() })
		.from(workRequest)
		.where(
			and(
				eq(workRequest.assetId, assetId),
				eq(workRequest.status, 'pending'),
				eq(workRequest.blocksUse, true)
			)
		);
	return Number(row?.n ?? 0) > 0;
}

/**
 * The coordinator's queue: everything raised and not yet dealt with.
 *
 * Oldest first. A report that has been sitting a fortnight is the one that has
 * gone wrong, and a queue sorted newest-first hides exactly that.
 */
export async function listPendingFlags() {
	return db
		.select({
			flag: workRequest,
			asset: inventoryAsset,
			item: inventoryItem,
			reporterName: user.name
		})
		.from(workRequest)
		.innerJoin(inventoryAsset, eq(inventoryAsset.id, workRequest.assetId))
		.innerJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
		.leftJoin(user, eq(user.id, workRequest.reportedByUserId))
		.where(and(eq(workRequest.status, 'pending'), isNull(workRequest.workOrderId)))
		.orderBy(asc(workRequest.createdAt));
}

/** Everything ever raised against one unit, newest first — the unit's own page. */
export async function listFlagsForAsset(assetId: string) {
	return db
		.select({ flag: workRequest, reporterName: user.name })
		.from(workRequest)
		.leftJoin(user, eq(user.id, workRequest.reportedByUserId))
		.where(eq(workRequest.assetId, assetId))
		.orderBy(desc(workRequest.createdAt));
}

/** Flags answered by one work order, so resolving it can close them together. */
export async function listFlagsForWorkOrder(workOrderId: string) {
	return db.select().from(workRequest).where(eq(workRequest.workOrderId, workOrderId));
}

/**
 * Point flags at the work order that answers them. N reports of one crackle
 * collapse onto one repair.
 */
export async function attachFlagsToWorkOrder(flagIds: string[], workOrderId: string) {
	if (flagIds.length === 0) return;
	await db
		.update(workRequest)
		.set({ workOrderId, updatedAt: new Date() })
		.where(inArray(workRequest.id, flagIds));
}

/** Nothing to do here — wrong, already fixed, or not actually a problem. */
export async function dismissFlag(id: string, staffUserId: string, notes?: string) {
	const now = new Date();
	const [row] = await db
		.update(workRequest)
		.set({
			status: 'dismissed',
			resolvedByUserId: staffUserId,
			resolutionNotes: notes ?? null,
			resolvedAt: now,
			updatedAt: now
		})
		.where(and(eq(workRequest.id, id), eq(workRequest.status, 'pending')))
		.returning();
	if (!row) throw new FlagNotFoundError();
	return row;
}

/**
 * Close every flag a work order answered.
 *
 * Returns the reporters, deduped, so the caller can tell them it is fixed — the
 * thing that never happened before and the reason anybody reports a second time.
 * A null reporter is a deleted account, not a bug.
 */
export async function resolveFlagsForWorkOrder(
	workOrderId: string,
	staffUserId: string,
	notes?: string
): Promise<string[]> {
	const now = new Date();
	const rows = await db
		.update(workRequest)
		.set({
			status: 'resolved',
			resolvedByUserId: staffUserId,
			resolutionNotes: notes ?? null,
			resolvedAt: now,
			updatedAt: now
		})
		.where(and(eq(workRequest.workOrderId, workOrderId), eq(workRequest.status, 'pending')))
		.returning();

	return [
		...new Set(rows.map((r) => r.reportedByUserId).filter((id): id is string => id !== null))
	];
}
