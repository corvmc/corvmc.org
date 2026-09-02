import { db } from '$lib/server/db';
import { contractor, contractorJob } from '$lib/server/db/schema/contractor';
import { inventoryAsset, inventoryItem } from '$lib/server/db/schema/inventory';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { setAssetStatus } from '$lib/server/inventory/asset-service';
import { getContractorById } from './contractor-service';
import type { ContractorJobStatus } from '$lib/config';

/**
 * One engagement with a contractor, from "we should call somebody" to the
 * invoice.
 *
 * **Custody is never written here.** A unit going to the shop and coming back is
 * a change of asset status, and `setAssetStatus` is the single writer of the
 * stock ledger — it already emits `repair_out` on the way out and `repair_in` on
 * the way back. This module decides *when* those happen and lets that function
 * decide what they mean, which is what keeps this path and the work-order path
 * from drifting into two different accounts of the same amp.
 */

export class ContractorJobNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Job not found');
	}
}

export class ContractorJobStateError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
	}
}

const TERMINAL: ContractorJobStatus[] = ['completed', 'cancelled'];

export interface CreateJobInput {
	contractorId: string;
	summary: string;
	/** The unit being worked on. Omitted for building work. */
	assetId?: string | null;
	scheduledFor?: Date | null;
	expectedBackAt?: Date | null;
	quotedCents?: number | null;
	notes?: string | null;
	requestedByUserId?: string | null;
}

export async function createJob(data: CreateJobInput) {
	// Validates the contractor exists, and refuses to hang a new job off someone
	// who has been retired — archiving is meant to stop new work, not just tidy
	// the picker.
	const who = await getContractorById(data.contractorId);
	if (who.archivedAt) {
		throw new ContractorJobStateError('That contractor has been archived');
	}

	const [row] = await db.insert(contractorJob).values(data).returning();
	return row;
}

/**
 * The work is booked: they are coming, or the unit has gone to them.
 *
 * This is where an asset leaves service. Only from `in_service` — a unit that is
 * `on_loan` is in a member's car and not ours to send anywhere, and one that is
 * already in `maintenance` is a second job on a unit that never came back, which
 * is legitimate and must not write a second `repair_out`.
 */
export async function scheduleJob(
	id: string,
	opts: { scheduledFor?: Date; expectedBackAt?: Date; actorId?: string } = {}
) {
	const job = await getJobById(id);
	if (TERMINAL.includes(job.status)) {
		throw new ContractorJobStateError(`A ${job.status} job cannot be scheduled`);
	}

	const [row] = await db
		.update(contractorJob)
		.set({
			status: 'scheduled',
			scheduledFor: opts.scheduledFor ?? job.scheduledFor,
			expectedBackAt: opts.expectedBackAt ?? job.expectedBackAt,
			updatedAt: new Date()
		})
		.where(eq(contractorJob.id, id))
		.returning();

	if (job.assetId) {
		const asset = await assetStatusOf(job.assetId);
		if (asset === 'in_service') {
			await setAssetStatus(job.assetId, 'maintenance', {
				notes: `Out for repair: ${job.summary}`,
				actorId: opts.actorId
			});
		}
	}

	return row;
}

/**
 * The work is done, and usually the invoice is in.
 *
 * Bringing the unit back is conditional on it still being in `maintenance`: if
 * somebody already put it back by hand, or it was retired as beyond repair while
 * it sat at the shop, this must not drag it out of that state.
 */
export async function completeJob(
	id: string,
	opts: {
		completedAt?: Date;
		costCents?: number | null;
		invoiceRef?: string | null;
		notes?: string | null;
		/** Leave the unit out of service — the repair did not take. */
		returnToService?: boolean;
		actorId?: string;
	} = {}
) {
	const job = await getJobById(id);
	if (TERMINAL.includes(job.status)) {
		throw new ContractorJobStateError(`This job is already ${job.status}`);
	}

	const now = new Date();
	const [row] = await db
		.update(contractorJob)
		.set({
			status: 'completed',
			completedAt: opts.completedAt ?? now,
			costCents: opts.costCents ?? job.costCents,
			invoiceRef: opts.invoiceRef ?? job.invoiceRef,
			notes: opts.notes ?? job.notes,
			updatedAt: now
		})
		.where(eq(contractorJob.id, id))
		.returning();

	if (job.assetId && opts.returnToService !== false) {
		const asset = await assetStatusOf(job.assetId);
		if (asset === 'maintenance') {
			await setAssetStatus(job.assetId, 'in_service', {
				notes: `Back from repair: ${job.summary}`,
				actorId: opts.actorId
			});
		}
	}

	return row;
}

/**
 * Called off.
 *
 * **The asset is deliberately left where it is.** Cancelling the engagement does
 * not mend the amp — a unit taken out of service because it was broken is still
 * broken when the tech cancels, and returning it to the pool here would put it
 * in front of the next member who books.
 */
export async function cancelJob(id: string) {
	const job = await getJobById(id);
	if (TERMINAL.includes(job.status)) {
		throw new ContractorJobStateError(`This job is already ${job.status}`);
	}

	const [row] = await db
		.update(contractorJob)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(eq(contractorJob.id, id))
		.returning();

	return row;
}

/** The invoice, arriving after the work — the common order of events. */
export async function recordInvoice(
	id: string,
	data: { costCents?: number | null; invoiceRef?: string | null; paidAt?: Date | null }
) {
	await getJobById(id);

	const [row] = await db
		.update(contractorJob)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(contractorJob.id, id))
		.returning();

	return row;
}

export async function getJobById(id: string) {
	const [row] = await db.select().from(contractorJob).where(eq(contractorJob.id, id)).limit(1);
	if (!row) throw new ContractorJobNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One row per job, with the contractor and the unit it is about already joined on. */
function jobRowQuery() {
	return db
		.select({
			job: contractorJob,
			contractor,
			assetTag: inventoryAsset.assetTag,
			itemName: inventoryItem.name
		})
		.from(contractorJob)
		.innerJoin(contractor, eq(contractorJob.contractorId, contractor.id))
		.leftJoin(inventoryAsset, eq(contractorJob.assetId, inventoryAsset.id))
		.leftJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id));
}

export async function listJobs(
	opts: { status?: ContractorJobStatus; contractorId?: string; assetId?: string } = {}
) {
	return jobRowQuery()
		.where(
			and(
				opts.status ? eq(contractorJob.status, opts.status) : undefined,
				opts.contractorId ? eq(contractorJob.contractorId, opts.contractorId) : undefined,
				opts.assetId ? eq(contractorJob.assetId, opts.assetId) : undefined
			)
		)
		.orderBy(desc(contractorJob.createdAt));
}

/**
 * Out with somebody and past the date they promised.
 *
 * Derived, not stored — the same call `listLateOrders` makes, and for the same
 * reason: an `overdue` status would need something to come along and set it, and
 * the day that something fails is the day the list quietly empties.
 */
export async function listOverdueJobs(now: Date = new Date()) {
	return jobRowQuery()
		.where(
			and(
				eq(contractorJob.status, 'scheduled'),
				sql`${contractorJob.expectedBackAt} is not null`,
				sql`${contractorJob.expectedBackAt} < ${Math.floor(now.getTime() / 1000)}`
			)
		)
		.orderBy(asc(contractorJob.expectedBackAt));
}

/** This unit's service history, newest first. Drives the asset page's panel. */
export async function jobsForAsset(assetId: string) {
	return db
		.select({ job: contractorJob, contractor })
		.from(contractorJob)
		.innerJoin(contractor, eq(contractorJob.contractorId, contractor.id))
		.where(eq(contractorJob.assetId, assetId))
		.orderBy(desc(contractorJob.createdAt));
}

/**
 * What was spent on services in a window, by trade.
 *
 * Deliberately its own function rather than a widening of `spendByCategory`.
 * That report counts `acquisition` lines, and an acquisition means goods
 * arrived; labor arrives as nothing, has no line and belongs to no equipment
 * category. Two sources on one page is honest — one source that has quietly
 * learned to mean two things is not.
 *
 * Counts `completed` jobs by `completedAt`, so a cancelled job and a quote
 * nobody accepted contribute nothing.
 */
export async function contractorSpend(from: Date, to: Date) {
	return db
		.select({
			trade: contractor.trade,
			jobCount: sql<number>`COUNT(*)`,
			totalCents: sql<number>`COALESCE(SUM(COALESCE(${contractorJob.costCents}, 0)), 0)`
		})
		.from(contractorJob)
		.innerJoin(contractor, eq(contractorJob.contractorId, contractor.id))
		.where(
			and(
				eq(contractorJob.status, 'completed'),
				sql`${contractorJob.completedAt} is not null`,
				sql`${contractorJob.completedAt} >= ${Math.floor(from.getTime() / 1000)}`,
				sql`${contractorJob.completedAt} < ${Math.floor(to.getTime() / 1000)}`
			)
		)
		.groupBy(contractor.trade)
		.orderBy(desc(sql`COALESCE(SUM(COALESCE(${contractorJob.costCents}, 0)), 0)`));
}

async function assetStatusOf(assetId: string) {
	const [row] = await db
		.select({ status: inventoryAsset.status })
		.from(inventoryAsset)
		.where(eq(inventoryAsset.id, assetId))
		.limit(1);
	return row?.status ?? null;
}
