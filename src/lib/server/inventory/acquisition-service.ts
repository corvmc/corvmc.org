import { db } from '$lib/server/db';
import {
	acquisition,
	acquisitionLine,
	equipmentCategory,
	inventoryItem
} from '$lib/server/db/schema/inventory';
import { user } from '$lib/server/db/schema/authentication';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { recordMovement } from './stock-service';
import { createAsset } from './asset-service';
import { CAPITALIZATION_THRESHOLD_CENTS, type AcquisitionKind } from '$lib/config';
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
	locationId?: string;
	notes?: string;
	lines: AcquisitionLineInput[];
	recordedByUserId?: string;
}

/**
 * Whether a thing at this value is tracked as an asset or expensed as stock.
 *
 * The threshold is the organisation's capitalization policy, which is the same
 * number FASB ASU 2020-07 leans on when it asks whether a contributed asset was
 * capitalized or expensed. It lives in config so changing it is a decision with
 * a paper trail rather than a migration.
 */
export function isCapitalized(unitValueCents: number | null | undefined): boolean {
	return (unitValueCents ?? 0) >= CAPITALIZATION_THRESHOLD_CENTS;
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
	const [header] = await db
		.select({ acquisition, donorName: user.name })
		.from(acquisition)
		.leftJoin(user, eq(acquisition.donorUserId, user.id))
		.where(eq(acquisition.id, id))
		.limit(1);

	if (!header) return null;

	const lines = await db
		.select({ line: acquisitionLine, item: inventoryItem })
		.from(acquisitionLine)
		.innerJoin(inventoryItem, eq(acquisitionLine.itemId, inventoryItem.id))
		.where(eq(acquisitionLine.acquisitionId, id));

	return {
		...header.acquisition,
		donorName: header.acquisition.donorUserId ? header.donorName : header.acquisition.sourceName,
		lines: lines.map((l) => ({ ...l.line, item: l.item }))
	};
}

export async function listAcquisitions(opts: { kind?: AcquisitionKind; limit?: number } = {}) {
	return db
		.select({ acquisition, donorName: user.name })
		.from(acquisition)
		.leftJoin(user, eq(acquisition.donorUserId, user.id))
		.where(opts.kind ? eq(acquisition.kind, opts.kind) : undefined)
		.orderBy(desc(acquisition.occurredAt))
		.limit(opts.limit ?? 100)
		.then((rows) =>
			rows.map((r) => ({
				...r.acquisition,
				donorName: r.acquisition.donorUserId ? r.donorName : r.acquisition.sourceName
			}))
		);
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
