import { db } from '$lib/server/db';
import {
	acquisition,
	acquisitionLine,
	equipmentCategory,
	inventoryItem,
	stockMovement
} from '$lib/server/db/schema/inventory';
import { user } from '$lib/server/db/schema/authentication';
import { alias } from 'drizzle-orm/sqlite-core';
import { listFor } from '$lib/server/media/media-service';
import { resolveImageUrl } from '$lib/server/storage';
import { and, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { recordMovement } from './stock-service';
import { createAsset } from './asset-service';
import { type AcquisitionKind } from '$lib/config';
import type { EquipmentCondition } from '$lib/config';

/**
 * How stock arrives — purchase, donation or grant.
 *
 * **All receiving goes through here**, including the $4 pack of strings somebody
 * picked up on the way in. That is not bureaucracy: a `receive` movement with no
 * cost or source attached is a row no later migration can improve, because by
 * the time the reporting is built the receipt is gone. Spend history is the one
 * thing that cannot be backfilled.
 */

export class AcquisitionNotFoundError extends Error {
	constructor() {
		super('Acquisition not found');
		this.name = 'AcquisitionNotFoundError';
	}
}

export interface AcquisitionLineInput {
	itemId: string;
	quantity: number;
	unitValueCents?: number;
	/** Serialized lines only — one entry per unit received. */
	units?: { assetTag?: string; serialNumber?: string; condition?: EquipmentCondition }[];
}

export interface CreateAcquisitionData {
	kind: AcquisitionKind;
	occurredAt: Date;
	sourceName?: string;
	donorUserId?: string;
	reference?: string;
	totalCents?: number;
	fairValueCents?: number;
	fairValueBasis?: string;
	intendedUse?: string;
	monetized?: boolean;
	/** Who fronted the money, when the collective's own card was not used. */
	paidByUserId?: string;
	locationId?: string;
	notes?: string;
	lines: AcquisitionLineInput[];
	recordedByUserId?: string;
}

export async function recordAcquisition(data: CreateAcquisitionData) {
	const [header] = await db
		.insert(acquisition)
		.values({
			kind: data.kind,
			occurredAt: data.occurredAt,
			sourceName: data.sourceName ?? null,
			donorUserId: data.donorUserId ?? null,
			reference: data.reference ?? null,
			totalCents: data.totalCents ?? null,
			fairValueCents: data.fairValueCents ?? null,
			fairValueBasis: data.fairValueBasis ?? null,
			intendedUse: data.intendedUse ?? null,
			monetized: data.monetized ?? false,
			paidByUserId: data.paidByUserId ?? null,
			recordedByUserId: data.recordedByUserId ?? null,
			notes: data.notes ?? null
		})
		.returning();

	for (const line of data.lines) {
		await db.insert(acquisitionLine).values({
			acquisitionId: header.id,
			itemId: line.itemId,
			quantity: line.quantity,
			unitValueCents: line.unitValueCents ?? null
		});

		const [item] = await db
			.select({ kind: inventoryItem.kind })
			.from(inventoryItem)
			.where(eq(inventoryItem.id, line.itemId))
			.limit(1);

		if (item?.kind === 'serialized') {
			// One asset per unit. `createAsset` writes its own `receive`, so this
			// branch must not also write one — that would double the count.
			const units: NonNullable<AcquisitionLineInput['units']> =
				line.units ?? Array.from({ length: line.quantity }, () => ({}));
			for (const unit of units) {
				await createAsset({
					itemId: line.itemId,
					assetTag: unit.assetTag,
					serialNumber: unit.serialNumber,
					condition: unit.condition ?? 'good',
					locationId: data.locationId,
					acquisitionId: header.id,
					actorId: data.recordedByUserId
				});
			}
		} else {
			await recordMovement({
				itemId: line.itemId,
				quantity: line.quantity,
				reason: 'receive',
				locationId: data.locationId ?? null,
				acquisitionId: header.id,
				actorId: data.recordedByUserId ?? null
			});
		}
	}

	return header;
}

/** Using up bulk stock. The one movement that has no return leg. */
export async function consumeStock(input: {
	itemId: string;
	quantity: number;
	locationId?: string;
	actorId?: string;
	notes?: string;
}) {
	return recordMovement({
		itemId: input.itemId,
		quantity: input.quantity,
		reason: 'consume',
		locationId: input.locationId ?? null,
		actorId: input.actorId ?? null,
		notes: input.notes ?? null
	});
}

/** A stocktake correction — the honest way to change a count. */
export async function adjustStock(input: {
	itemId: string;
	delta: number;
	locationId?: string;
	actorId?: string;
	notes?: string;
}) {
	return recordMovement({
		itemId: input.itemId,
		quantity: input.delta,
		reason: 'adjust',
		locationId: input.locationId ?? null,
		actorId: input.actorId ?? null,
		notes: input.notes ?? null
	});
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getAcquisitionById(id: string) {
	const payer = alias(user, 'payer');

	const [header] = await db
		.select({ acquisition, donorName: user.name, paidByName: payer.name })
		.from(acquisition)
		.leftJoin(user, eq(acquisition.donorUserId, user.id))
		.leftJoin(payer, eq(acquisition.paidByUserId, payer.id))
		.where(eq(acquisition.id, id))
		.limit(1);

	if (!header) return null;

	// One round trip for the three things the detail page always shows. The
	// movements are included because they are the proof the acquisition did
	// something: an acquisition whose lines wrote no `receive` is a paperwork
	// row with no stock behind it, and that is worth being able to see.
	const [lines, movements, receipts] = await Promise.all([
		db
			.select({ line: acquisitionLine, item: inventoryItem })
			.from(acquisitionLine)
			.innerJoin(inventoryItem, eq(acquisitionLine.itemId, inventoryItem.id))
			.where(eq(acquisitionLine.acquisitionId, id)),
		db
			.select({ movement: stockMovement, item: inventoryItem })
			.from(stockMovement)
			.innerJoin(inventoryItem, eq(stockMovement.itemId, inventoryItem.id))
			.where(eq(stockMovement.acquisitionId, id))
			.orderBy(desc(stockMovement.occurredAt)),
		listFor('acquisition', id, 'receipt')
	]);

	return {
		...header.acquisition,
		donorName: header.acquisition.donorUserId ? header.donorName : header.acquisition.sourceName,
		paidByName: header.paidByName,
		lines: lines.map((l) => ({ ...l.line, item: l.item })),
		movements: movements.map((m) => ({ ...m.movement, item: m.item })),
		// Resolved here because `resolveImageUrl` lives in `$lib/server/`, which
		// components may not import — the same reason `listItemResources` does it.
		receipts: receipts.map((r) => ({ ...r, url: resolveImageUrl(r.key) }))
	};
}

export interface ListAcquisitionsOptions {
	kind?: AcquisitionKind;
	from?: Date;
	to?: Date;
	/** Somebody fronted the money and has not been paid back. */
	awaitingReimbursement?: boolean;
	limit?: number;
}

export async function listAcquisitions(opts: ListAcquisitionsOptions = {}) {
	const payer = alias(user, 'payer');

	const filters = [
		opts.kind ? eq(acquisition.kind, opts.kind) : undefined,
		opts.from ? gte(acquisition.occurredAt, opts.from) : undefined,
		opts.to ? lte(acquisition.occurredAt, opts.to) : undefined,
		// Owed, not merely unpaid: an acquisition nobody fronted is not a debt.
		opts.awaitingReimbursement
			? and(isNotNull(acquisition.paidByUserId), isNull(acquisition.reimbursedAt))
			: undefined
	].filter(Boolean);

	return db
		.select({
			acquisition,
			donorName: user.name,
			paidByName: payer.name,
			lineCount: sql<number>`(
				SELECT COUNT(*) FROM ${acquisitionLine}
				WHERE ${acquisitionLine.acquisitionId} = ${acquisition.id}
			)`,
			// The header's own `totalCents` is what somebody typed; this is what the
			// lines actually add up to. The list shows the latter, so a header that
			// was never filled in still reports a number.
			linesTotalCents: sql<number>`(
				SELECT COALESCE(SUM(${acquisitionLine.quantity} * COALESCE(${acquisitionLine.unitValueCents}, 0)), 0)
				FROM ${acquisitionLine}
				WHERE ${acquisitionLine.acquisitionId} = ${acquisition.id}
			)`
		})
		.from(acquisition)
		.leftJoin(user, eq(acquisition.donorUserId, user.id))
		.leftJoin(payer, eq(acquisition.paidByUserId, payer.id))
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(desc(acquisition.occurredAt))
		.limit(opts.limit ?? 100)
		.then((rows) =>
			rows.map((r) => ({
				...r.acquisition,
				donorName: r.acquisition.donorUserId ? r.donorName : r.acquisition.sourceName,
				paidByName: r.paidByName,
				lineCount: r.lineCount,
				linesTotalCents: r.linesTotalCents
			}))
		);
}

// ---------------------------------------------------------------------------
// Amending
// ---------------------------------------------------------------------------

/**
 * Correcting an acquisition after the fact.
 *
 * Receiving captures what is known at the door, and several of these fields are
 * not known then: a Form 8283 is signed weeks later, a fair-value basis may take
 * an appraisal, and whether a gift was sold or used is decided after it arrives.
 * Without this the disclosure columns are write-once at the one moment their
 * answers are least available — which is why they sat empty in production.
 *
 * The **lines are deliberately not editable here.** They have already emitted
 * `receive` movements, and silently rewriting a quantity would put the ledger
 * and the paperwork into permanent disagreement. A miscount is fixed the way
 * every other stock error is: an `adjust` movement.
 */
export interface UpdateAcquisitionData {
	occurredAt?: Date;
	/**
	 * Correctable because it is guessed at entry, and because it decides which
	 * report the row lands in: `spendByCategory` counts `purchase`, the FASB
	 * gifts-in-kind report counts `donation`, and `opening_balance` is in
	 * neither. A row filed under the wrong one is money in the wrong year.
	 */
	kind?: AcquisitionKind;
	sourceName?: string | null;
	donorUserId?: string | null;
	reference?: string | null;
	totalCents?: number | null;
	fairValueCents?: number | null;
	fairValueBasis?: string | null;
	intendedUse?: string | null;
	monetized?: boolean;
	appraisalRef?: string | null;
	paidByUserId?: string | null;
	notes?: string | null;
}

export async function updateAcquisition(id: string, data: UpdateAcquisitionData) {
	const [row] = await db
		.update(acquisition)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(acquisition.id, id))
		.returning();

	if (!row) throw new AcquisitionNotFoundError();
	return row;
}

/**
 * Recording that CMC signed the donor's Form 8283.
 *
 * **This is what arms Form 8282.** `form8282Status` treats a gift with no signed
 * 8283 as owing nothing — correctly, since the IRS defines the reportable class
 * as property the donee signed for — so until this is set, a donated unit can be
 * disposed of and the compliance page stays silent. It shipped in #302/#309 with
 * the rule tested and no way to reach it.
 *
 * Passing `null` unsigns it, because "we recorded that in error" has to be as
 * expressible as recording it.
 */
export async function acknowledgeForm8283(
	id: string,
	input: { acknowledgedAt: Date | null; appraisalRef?: string | null }
) {
	const [row] = await db
		.update(acquisition)
		.set({
			acknowledgedAt: input.acknowledgedAt,
			appraisalRef: input.appraisalRef ?? null,
			updatedAt: new Date()
		})
		.where(eq(acquisition.id, id))
		.returning();

	if (!row) throw new AcquisitionNotFoundError();
	return row;
}

/**
 * Settling what somebody fronted.
 *
 * The transfer happens outside the app — this records that a person dealt with
 * it, the same shape as `resolveForm8282`. Idempotent by intent: re-marking an
 * already-settled acquisition keeps the original date rather than moving it, so
 * a double click cannot rewrite when somebody was actually paid.
 */
export async function markReimbursed(id: string, now = new Date()) {
	const existing = await db
		.select({ reimbursedAt: acquisition.reimbursedAt, paidByUserId: acquisition.paidByUserId })
		.from(acquisition)
		.where(eq(acquisition.id, id))
		.limit(1);

	if (!existing.length) throw new AcquisitionNotFoundError();
	if (existing[0].reimbursedAt) return existing[0].reimbursedAt;

	await db
		.update(acquisition)
		.set({ reimbursedAt: now, updatedAt: new Date() })
		.where(eq(acquisition.id, id));

	return now;
}

/**
 * Spend by category over a window — the Phase 2 report, and the answer to "what
 * do we spend on sticks in a year" that the old schema could not give at all.
 */
export async function spendByCategory(from: Date, to: Date, kind: AcquisitionKind = 'purchase') {
	return db
		.select({
			categoryId: equipmentCategory.id,
			categoryName: equipmentCategory.name,
			totalCents: sql<number>`COALESCE(SUM(${acquisitionLine.quantity} * COALESCE(${acquisitionLine.unitValueCents}, 0)), 0)`,
			units: sql<number>`COALESCE(SUM(${acquisitionLine.quantity}), 0)`
		})
		.from(acquisitionLine)
		.innerJoin(acquisition, eq(acquisitionLine.acquisitionId, acquisition.id))
		.innerJoin(inventoryItem, eq(acquisitionLine.itemId, inventoryItem.id))
		.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.where(
			and(
				eq(acquisition.kind, kind),
				gte(acquisition.occurredAt, from),
				lte(acquisition.occurredAt, to)
			)
		)
		.groupBy(equipmentCategory.id, equipmentCategory.name)
		.orderBy(equipmentCategory.name);
}

/**
 * Contributed nonfinancial assets, disaggregated by category.
 *
 * The shape FASB ASU 2020-07 asks for: gifts-in-kind as their own line, broken
 * down by the type of asset contributed, with whether each was monetized or
 * utilized. Phase 3 renders it; the fields it reads have been captured since
 * Phase 1 precisely so this is a query and not an archaeology project.
 */
export async function inKindContributions(from: Date, to: Date) {
	return db
		.select({
			categoryName: equipmentCategory.name,
			monetized: acquisition.monetized,
			fairValueCents: sql<number>`COALESCE(SUM(${acquisitionLine.quantity} * COALESCE(${acquisitionLine.unitValueCents}, 0)), 0)`,
			units: sql<number>`COALESCE(SUM(${acquisitionLine.quantity}), 0)`
		})
		.from(acquisitionLine)
		.innerJoin(acquisition, eq(acquisitionLine.acquisitionId, acquisition.id))
		.innerJoin(inventoryItem, eq(acquisitionLine.itemId, inventoryItem.id))
		.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.where(
			and(
				eq(acquisition.kind, 'donation'),
				gte(acquisition.occurredAt, from),
				lte(acquisition.occurredAt, to)
			)
		)
		.groupBy(equipmentCategory.name, acquisition.monetized)
		.orderBy(equipmentCategory.name);
}
