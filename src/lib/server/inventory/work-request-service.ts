import { db } from '$lib/server/db';
import { workRequest, inventoryAsset, inventoryItem } from '$lib/server/db/schema/inventory';
import { user } from '$lib/server/db/schema/authentication';
import { workOrder, volunteerRole } from '$lib/server/db/schema/volunteer';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { containsLiteral } from '$lib/server/db/like';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { toGenericRef } from '$lib/server/entity/refs';
import { AssetNotFoundError, setAssetStatus } from './asset-service';
import type { EquipmentCondition } from '$lib/config';
import { DomainError } from '$lib/server/domain-error';
import { domainEvents } from '$lib/server/event-bus/event-bus';

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

export class AssetNotFlaggableError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('This unit has been retired or written off, so there is nothing to report against.');
		this.name = 'AssetNotFlaggableError';
	}
}

export class WorkRequestNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That report no longer exists');
		this.name = 'WorkRequestNotFoundError';
	}
}

export class WorkRequestTriageError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
		this.name = 'WorkRequestTriageError';
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
		.orderBy(asc(workRequest.createdAt), asc(workRequest.id));
}

/** Everything ever raised against one unit, newest first — the unit's own page. */
export async function listFlagsForAsset(assetId: string) {
	return db
		.select({ flag: workRequest, reporterName: user.name })
		.from(workRequest)
		.leftJoin(user, eq(user.id, workRequest.reportedByUserId))
		.where(eq(workRequest.assetId, assetId))
		.orderBy(desc(workRequest.createdAt), desc(workRequest.id));
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
	if (!row) throw new WorkRequestNotFoundError();
	return row;
}

/**
 * Close every flag a work order answered, and tell each reporter once.
 *
 * Returns the reporters, deduped. A null reporter is a deleted account, not a
 * bug. A failed notice never undoes the close: the reports are already shut.
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

	const reporters = [
		...new Set(rows.map((r) => r.reportedByUserId).filter((id): id is string => id !== null))
	];
	if (rows.length > 0) await announceResolved(workOrderId, rows[0].assetId, reporters);
	return reporters;
}

/** `sendToWorkOrder` only attaches reports on the work order's own unit, so one asset. */
async function announceResolved(workOrderId: string, assetId: string, reporters: string[]) {
	const [unit] = await db
		.select({ name: inventoryItem.name, assetTag: inventoryAsset.assetTag })
		.from(inventoryAsset)
		.innerJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
		.where(eq(inventoryAsset.id, assetId))
		.limit(1);
	if (!unit || reporters.length === 0) return;

	const people = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(inArray(user.id, reporters));
	const equipmentName = unit.assetTag ? `${unit.name} (${unit.assetTag})` : unit.name;

	for (const person of people) {
		try {
			await domainEvents.emit('equipment.report_resolved', {
				workOrderId,
				assetId,
				userId: person.id,
				userName: person.name,
				userEmail: person.email,
				equipmentName
			});
		} catch (err) {
			console.error(`[work-request] fixed notice failed for ${person.id}:`, err);
		}
	}
}

// ---------------------------------------------------------------------------
// Triage — the staff queue. It renders on the flags surface (#552), but the
// rules stay here: a repeat report is data, so nothing collapses on write.
// ---------------------------------------------------------------------------

/**
 * Where a report is in triage. `untriaged` and `in_work_order` are both
 * `pending` in the table — the work order is what separates them.
 */
export const workRequestStages = ['untriaged', 'in_work_order', 'resolved', 'dismissed'] as const;
export type WorkRequestStage = (typeof workRequestStages)[number];

function stageWhere(stage: WorkRequestStage | undefined) {
	switch (stage) {
		case 'untriaged':
			return and(eq(workRequest.status, 'pending'), isNull(workRequest.workOrderId));
		case 'in_work_order':
			return and(eq(workRequest.status, 'pending'), isNotNull(workRequest.workOrderId));
		case 'resolved':
		case 'dismissed':
			return eq(workRequest.status, stage);
		default:
			return undefined;
	}
}

function stageOf(row: { status: string; workOrderId: string | null }): WorkRequestStage {
	if (row.status === 'pending') return row.workOrderId ? 'in_work_order' : 'untriaged';
	return row.status as WorkRequestStage;
}

/** The queue, oldest first for the same reason `listPendingFlags` is. */
export async function listWorkRequests(
	filters: { stage?: WorkRequestStage; search?: string },
	pagination: PaginationInput
) {
	const term = filters.search?.trim();
	const where = and(
		stageWhere(filters.stage),
		term
			? or(containsLiteral(workRequest.note, term), containsLiteral(inventoryItem.name, term))
			: undefined
	);

	const dataQ = db
		.select({
			id: workRequest.id,
			status: workRequest.status,
			workOrderId: workRequest.workOrderId,
			note: workRequest.note,
			blocksUse: workRequest.blocksUse,
			createdAt: workRequest.createdAt,
			assetId: inventoryAsset.id,
			assetTag: inventoryAsset.assetTag,
			itemName: inventoryItem.name,
			reportedByName: user.name
		})
		.from(workRequest)
		.innerJoin(inventoryAsset, eq(inventoryAsset.id, workRequest.assetId))
		.innerJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
		.leftJoin(user, eq(user.id, workRequest.reportedByUserId))
		.where(where)
		.orderBy(asc(workRequest.createdAt), asc(workRequest.id))
		.$dynamic();

	const countQ = db
		.select({ count: count() })
		.from(workRequest)
		.innerJoin(inventoryAsset, eq(inventoryAsset.id, workRequest.assetId))
		.innerJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
		.where(where);

	const { rows, pagination: pageInfo } = await paginate(dataQ, countQ, pagination);
	return {
		rows: rows.map((r) => ({
			id: r.id,
			status: r.status,
			stage: stageOf(r),
			note: r.note,
			blocksUse: r.blocksUse,
			createdAt: r.createdAt,
			reportedByName: r.reportedByName,
			asset: toGenericRef('asset', { id: r.assetId, title: r.itemName, subtitle: r.assetTag })
		})),
		pagination: pageInfo
	};
}

/** One report, with what triage needs beside it: the unit, its other reports, its open work. */
export async function getWorkRequestDetail(id: string) {
	const [row] = await db
		.select({
			request: workRequest,
			asset: inventoryAsset,
			itemName: inventoryItem.name,
			reporterName: user.name,
			reporterEmail: user.email
		})
		.from(workRequest)
		.innerJoin(inventoryAsset, eq(inventoryAsset.id, workRequest.assetId))
		.innerJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
		.leftJoin(user, eq(user.id, workRequest.reportedByUserId))
		.where(eq(workRequest.id, id))
		.limit(1);
	if (!row) throw new WorkRequestNotFoundError();

	const [others, openWork] = await Promise.all([
		db
			.select({
				id: workRequest.id,
				note: workRequest.note,
				createdAt: workRequest.createdAt,
				reporterName: user.name
			})
			.from(workRequest)
			.leftJoin(user, eq(user.id, workRequest.reportedByUserId))
			.where(and(eq(workRequest.assetId, row.asset.id), eq(workRequest.status, 'pending')))
			.orderBy(asc(workRequest.createdAt), asc(workRequest.id)),
		db
			.select({
				id: workOrder.id,
				notes: workOrder.notes,
				dueAt: workOrder.dueAt,
				startsAt: workOrder.startsAt,
				roleName: volunteerRole.name
			})
			.from(workOrder)
			.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
			.where(
				and(
					eq(workOrder.assetId, row.asset.id),
					isNull(workOrder.resolvedAt),
					isNull(workOrder.cancelledAt)
				)
			)
			.orderBy(asc(workOrder.createdAt), asc(workOrder.id))
	]);

	return {
		...row.request,
		stage: stageOf(row.request),
		reporterName: row.reporterName,
		reporterEmail: row.reporterEmail,
		asset: toGenericRef('asset', {
			id: row.asset.id,
			title: row.itemName,
			subtitle: row.asset.assetTag,
			status: row.asset.status
		}),
		otherPending: others.filter((o) => o.id !== id),
		openWorkOrders: openWork
	};
}

export type WorkOrderTarget =
	| { workOrderId: string }
	| { newOrder: { volunteerRoleId: string; notes?: string | null; dueAt?: Date | null } };

/**
 * Hand a report to the work that will fix it — an open work order on the same
 * unit, or a new one. Every other untriaged report on the unit goes with it.
 */
export async function sendToWorkOrder(
	requestId: string,
	target: WorkOrderTarget,
	staffUserId: string
): Promise<{ workOrderId: string; attached: number }> {
	const [request] = await db
		.select()
		.from(workRequest)
		.where(eq(workRequest.id, requestId))
		.limit(1);
	if (!request) throw new WorkRequestNotFoundError();
	if (request.status !== 'pending') {
		throw new WorkRequestTriageError('That report has already been closed.');
	}

	let workOrderId: string;
	if ('workOrderId' in target) {
		const [order] = await db
			.select({
				id: workOrder.id,
				assetId: workOrder.assetId,
				resolvedAt: workOrder.resolvedAt,
				cancelledAt: workOrder.cancelledAt
			})
			.from(workOrder)
			.where(eq(workOrder.id, target.workOrderId))
			.limit(1);
		if (!order || order.assetId !== request.assetId) {
			throw new WorkRequestTriageError('That work order is not for this unit.');
		}
		if (order.resolvedAt || order.cancelledAt) {
			throw new WorkRequestTriageError('That work order is already closed.');
		}
		workOrderId = order.id;
	} else {
		const { createWorkOrder } = await import('../volunteer/work-order-service');
		const order = await createWorkOrder({
			volunteerRoleId: target.newOrder.volunteerRoleId,
			assetId: request.assetId,
			notes: target.newOrder.notes || request.note,
			dueAt: target.newOrder.dueAt ?? null,
			createdByUserId: staffUserId
		});
		workOrderId = order.id;
	}

	const untriaged = await db
		.select({ id: workRequest.id })
		.from(workRequest)
		.where(
			and(
				eq(workRequest.assetId, request.assetId),
				eq(workRequest.status, 'pending'),
				isNull(workRequest.workOrderId)
			)
		);
	const ids = [...new Set([requestId, ...untriaged.map((r) => r.id)])];
	await attachFlagsToWorkOrder(ids, workOrderId);

	return { workOrderId, attached: ids.length };
}
