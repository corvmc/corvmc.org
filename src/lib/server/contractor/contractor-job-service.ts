import { completedJobEntries, lateInvoiceEntries } from '$lib/server/finance/contractor-entries';
import { entriesStatement } from '$lib/server/finance/financial-entry-service';
import { db } from '$lib/server/db';
import { contractor, contractorJob } from '$lib/server/db/schema/contractor';
import type { ContractorJob } from '$lib/server/db/schema/contractor';
import { inventoryAsset, inventoryItem } from '$lib/server/db/schema/inventory';
import { volunteerRole, workOrder } from '$lib/server/db/schema/volunteer';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { assetStatusChange, setAssetStatus } from '$lib/server/inventory/asset-service';
import { prepareResolveWorkOrder } from '$lib/server/volunteer/work-order-service';
import { getContractorById } from './contractor-service';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import type { RecordEntryInput } from '$lib/server/finance/financial-entry-service';
import type { ContractorJobStatus, ContractorJobView } from '$lib/config';

/**
 * One contractor's engagement on a work order, from "we asked them" to the
 * invoice. What the work is — title, unit, project — is read off the work
 * order; every read here returns it flattened onto the engagement.
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

/** Statuses an engagement does not leave. */
const TERMINAL: ContractorJobStatus[] = ['completed', 'cancelled', 'declined', 'no_show'];

/** The engagement with its work order's fields beside it, as every read returns it. */
const engagementSelect = {
	job: contractorJob,
	// A work order's own title, else its role's: one made here always has a title.
	title: sql<string>`coalesce(${workOrder.title}, ${volunteerRole.name}, 'Work order')`,
	assetId: workOrder.assetId,
	projectId: workOrder.projectId,
	workOrderResolvedAt: workOrder.resolvedAt,
	workOrderCancelledAt: workOrder.cancelledAt,
	contractorName: contractor.name
};

interface EngagementRow {
	job: ContractorJob;
	title: string;
	assetId: string | null;
	projectId: string | null;
	workOrderResolvedAt: Date | null;
	workOrderCancelledAt: Date | null;
	contractorName: string;
}

export type Engagement = ContractorJob & Omit<EngagementRow, 'job'>;

function flatten({ job, ...wo }: EngagementRow): Engagement {
	return { ...job, ...wo };
}

/**
 * An engagement's step, written on its work order's log so one read gives a
 * task's whole history. `from` null is the contractor being asked.
 */
async function auditEngagement(
	job: Engagement,
	from: ContractorJobStatus | null,
	to: ContractorJobStatus
): Promise<void> {
	await recordAuditEntry({
		action: 'contractor_job.status_changed',
		subject: { type: 'work_order', id: job.workOrderId, label: job.title },
		details: {
			engagementId: job.id,
			contractorName: job.contractorName,
			from,
			to,
			...(to === 'booked' ? { scheduledFor: job.scheduledFor?.toISOString() ?? null } : {})
		}
	});
}

export interface CreateJobInput {
	contractorId: string;
	/** Engage them on work that already exists. Otherwise a work order is made. */
	workOrderId?: string | null;
	/** The new work order's title. Required when `workOrderId` is absent. */
	title?: string | null;
	/** The unit being worked on. Omitted for building work. */
	assetId?: string | null;
	projectId?: string | null;
	scheduledFor?: Date | null;
	expectedBackAt?: Date | null;
	quotedCents?: number | null;
	notes?: string | null;
	requestedByUserId?: string | null;
}

/**
 * Engage a contractor. Without a `workOrderId` this also creates the work order
 * — no role, not posted to the claim board — in the same batch, so there is
 * never an engagement without its task or a task made for nobody.
 */
export async function createJob(data: CreateJobInput): Promise<Engagement> {
	// Archiving is meant to stop new work, not just tidy the picker.
	const who = await getContractorById(data.contractorId);
	if (who.archivedAt) {
		throw new ContractorJobStateError('That contractor has been archived');
	}

	const engagement = {
		contractorId: data.contractorId,
		scheduledFor: data.scheduledFor ?? null,
		expectedBackAt: data.expectedBackAt ?? null,
		quotedCents: data.quotedCents ?? null,
		notes: data.notes ?? null,
		requestedByUserId: data.requestedByUserId ?? null
	};

	if (data.workOrderId) {
		const [wo] = await db
			.select({
				id: workOrder.id,
				resolvedAt: workOrder.resolvedAt,
				cancelledAt: workOrder.cancelledAt
			})
			.from(workOrder)
			.where(eq(workOrder.id, data.workOrderId))
			.limit(1);
		if (!wo) throw new ContractorJobStateError('That work order does not exist');
		if (wo.cancelledAt) throw new ContractorJobStateError('That work order was called off');
		if (wo.resolvedAt) throw new ContractorJobStateError('That work order is already done');

		const [row] = await db
			.insert(contractorJob)
			.values({ ...engagement, workOrderId: wo.id })
			.returning();
		const asked = await getJobById(row.id);
		await auditEngagement(asked, null, 'asked');
		return asked;
	}

	const title = data.title?.trim();
	if (!title) throw new ContractorJobStateError('Say what the work is');

	const workOrderId = crypto.randomUUID();
	const jobId = crypto.randomUUID();
	await db.batch([
		db.insert(workOrder).values({
			id: workOrderId,
			title,
			assetId: data.assetId ?? null,
			projectId: data.projectId ?? null,
			volunteerRoleId: null,
			postedAt: null,
			createdByUserId: data.requestedByUserId ?? null
		}),
		db.insert(contractorJob).values({ ...engagement, id: jobId, workOrderId })
	]);
	const asked = await getJobById(jobId);
	await recordAuditEntry({
		action: 'work_order.created',
		subject: { type: 'work_order', id: workOrderId, label: title },
		details: { projectId: data.projectId ?? null, title }
	});
	await auditEngagement(asked, null, 'asked');
	return asked;
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
		throw new ContractorJobStateError(`A ${job.status} job cannot be booked`);
	}

	const [row] = await db
		.update(contractorJob)
		.set({
			status: 'booked',
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
				notes: `Out for repair: ${job.title}`,
				actorId: opts.actorId
			});
		}
	}

	await auditEngagement({ ...job, ...row }, job.status, 'booked');
	return { ...job, ...row };
}

/**
 * The contractor's work is done, and usually the invoice is in.
 *
 * Completing the engagement resolves its work order, through
 * `resolveWorkOrder` so the reports it answered close with it; resolving the
 * work order never completes an engagement. A work order already resolved or
 * called off is left as it is.
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
		/** They did the work and did not invoice for it. */
		isDonated?: boolean;
		fairValueCents?: number | null;
		fairValueBasis?: string | null;
		/** Who recorded it. Also who resolved the work order, when this does. */
		actorId: string;
	}
) {
	const job = await getJobById(id);
	if (TERMINAL.includes(job.status)) {
		throw new ContractorJobStateError(`This job is already ${job.status}`);
	}

	const isDonated = opts.isDonated ?? job.isDonated;
	const costCents = opts.costCents ?? job.costCents;

	// The invariant the schema cannot express: SQLite has no way to add a CHECK
	// through ALTER TABLE, so "donated implies nothing was paid" is enforced
	// here. It matters beyond tidiness — `getProjectBurn` reads the flag to keep
	// a job out of cash spend, so a row that is both would be counted twice, as
	// money spent and as value contributed.
	if (isDonated && costCents !== null && costCents > 0) {
		throw new ContractorJobStateError(
			'A donated job has no cost. Record the fair value instead, or clear the donated flag.'
		);
	}

	const now = new Date();
	const completedAt = opts.completedAt ?? now;
	const fairValueCents = isDonated ? (opts.fairValueCents ?? job.fairValueCents) : null;
	const engagementUpdate = db
		.update(contractorJob)
		.set({
			status: 'completed',
			completedAt,
			costCents: isDonated ? null : costCents,
			invoiceRef: opts.invoiceRef ?? job.invoiceRef,
			notes: opts.notes ?? job.notes,
			isDonated,
			fairValueCents,
			fairValueBasis: isDonated ? (opts.fairValueBasis ?? job.fairValueBasis) : null,
			updatedAt: now
		})
		.where(eq(contractorJob.id, id))
		.returning();

	const entries = completedJobEntries({
		jobId: id,
		title: job.title,
		projectId: job.projectId,
		occurredAt: completedAt,
		costCents: isDonated ? null : costCents,
		isDonated,
		fairValueCents
	});

	const backFromRepair =
		job.assetId &&
		opts.returnToService !== false &&
		(await assetStatusOf(job.assetId)) === 'maintenance'
			? await assetStatusChange(job.assetId, 'in_service', {
					notes: `Back from repair: ${job.title}`,
					actorId: opts.actorId
				})
			: null;

	const resolution =
		!job.workOrderResolvedAt && !job.workOrderCancelledAt
			? await prepareResolveWorkOrder(job.workOrderId, { resolvedByUserId: opts.actorId })
			: null;

	// The engagement, what it cost, the unit and the work order are one event:
	// as separate awaits, a failure part-way left a paid, completed job beside a
	// unit back in service on an open work order. db.batch, never db.transaction.
	const [[row]] = await db.batch([
		engagementUpdate,
		...(entries.length > 0 ? [entriesStatement(entries as [RecordEntryInput])] : []),
		...(backFromRepair?.statements ?? []),
		...(resolution?.statements ?? [])
	]);

	await auditEngagement(job, job.status, 'completed');
	await resolution?.afterCommit();

	return { ...job, ...row };
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

	await auditEngagement(job, job.status, 'cancelled');
	return { ...job, ...row };
}

/**
 * They said no. Terminal: asking again is a new engagement, so the refusal
 * stays on the record beside whoever said yes.
 */
export async function declineJob(id: string) {
	return closeUnworked(id, 'declined');
}

/**
 * Booked, and they did not come.
 *
 * **The asset is left where it is**, for `cancelJob`'s reason: a unit taken out
 * of service because it was broken is still broken, and putting it back in
 * the pool would hand it to the next member who books.
 */
export async function markJobNoShow(id: string) {
	return closeUnworked(id, 'no_show');
}

/** An engagement ending with nobody's work done: no custody, ledger or work order change. */
async function closeUnworked(id: string, status: 'declined' | 'no_show') {
	const job = await getJobById(id);
	if (TERMINAL.includes(job.status)) {
		throw new ContractorJobStateError(`This job is already ${job.status}`);
	}

	const [row] = await db
		.update(contractorJob)
		.set({ status, updatedAt: new Date() })
		.where(eq(contractorJob.id, id))
		.returning();

	await auditEngagement(job, job.status, status);
	return { ...job, ...row };
}

/** The invoice, arriving after the work — the common order of events. */
export async function recordInvoice(
	id: string,
	data: { costCents?: number | null; invoiceRef?: string | null; paidAt?: Date | null }
) {
	const job = await getJobById(id);

	// Refused rather than silently un-donating it. An invoice arriving on a job
	// somebody marked donated means one of the two is wrong, and which one is a
	// question for the staffer rather than for this function.
	if (job.isDonated && data.costCents !== null && data.costCents !== undefined) {
		throw new ContractorJobStateError(
			'This job is marked donated. Clear that first if an invoice arrived after all.'
		);
	}

	const update = db
		.update(contractorJob)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(contractorJob.id, id))
		.returning();

	// Completion books whatever cost it knew; an invoice after it books the rest.
	const entries =
		job.status === 'completed' && data.costCents !== undefined
			? lateInvoiceEntries({
					jobId: id,
					title: job.title,
					projectId: job.projectId,
					occurredAt: data.paidAt ?? new Date(),
					bookedCents: job.costCents,
					invoicedCents: data.costCents
				})
			: [];
	const [[row]] = await db.batch([
		update,
		...(entries.length > 0 ? [entriesStatement(entries as [RecordEntryInput])] : [])
	]);

	await recordAuditEntry({
		action: 'contractor_job.invoice_recorded',
		subject: { type: 'work_order', id: job.workOrderId, label: job.title },
		details: {
			engagementId: job.id,
			contractorName: job.contractorName,
			costCents: row.costCents,
			invoiceRef: row.invoiceRef
		}
	});
	return { ...job, ...row };
}

export async function getJobById(id: string): Promise<Engagement> {
	const [row] = await db
		.select(engagementSelect)
		.from(contractorJob)
		.innerJoin(workOrder, eq(contractorJob.workOrderId, workOrder.id))
		.innerJoin(contractor, eq(contractorJob.contractorId, contractor.id))
		.leftJoin(volunteerRole, eq(workOrder.volunteerRoleId, volunteerRole.id))
		.where(eq(contractorJob.id, id))
		.limit(1);
	if (!row) throw new ContractorJobNotFoundError();
	return flatten(row);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** 1 when the engagement is in `view` at `now`: the same predicate the filter runs. */
const inView = (view: ContractorJobView, now: Date) =>
	sql<number>`case when ${engagementViewWhere(view, now)} then 1 else 0 end`;

/** One row per engagement, with the contractor and the unit already joined on. */
function jobRowQuery(now: Date) {
	return db
		.select({
			...engagementSelect,
			contractor,
			assetTag: inventoryAsset.assetTag,
			itemName: inventoryItem.name,
			late: inView('late', now),
			awaitingInvoice: inView('awaiting-invoice', now)
		})
		.from(contractorJob)
		.innerJoin(workOrder, eq(contractorJob.workOrderId, workOrder.id))
		.leftJoin(volunteerRole, eq(workOrder.volunteerRoleId, volunteerRole.id))
		.innerJoin(contractor, eq(contractorJob.contractorId, contractor.id))
		.leftJoin(inventoryAsset, eq(workOrder.assetId, inventoryAsset.id))
		.leftJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id));
}

type JobRow = EngagementRow & {
	contractor: typeof contractor.$inferSelect;
	assetTag: string | null;
	itemName: string | null;
	late: number;
	awaitingInvoice: number;
};

function toJobRow({
	contractor: who,
	assetTag,
	itemName,
	late,
	awaitingInvoice,
	...engagement
}: JobRow) {
	return {
		job: flatten(engagement),
		contractor: who,
		assetTag,
		itemName,
		late: Boolean(late),
		awaitingInvoice: Boolean(awaitingInvoice)
	};
}

/**
 * The jobs list's filters as one predicate each, so the list and its tab
 * counts cannot disagree about what "late" means. Late is derived, not stored —
 * an `overdue` status would need something to set it, and the day that fails
 * is the day the list quietly empties.
 */
export function engagementViewWhere(view: ContractorJobView, now: Date): SQL | undefined {
	switch (view) {
		case 'open':
			return inArray(contractorJob.status, ['asked', 'booked']);
		case 'late':
			return and(
				eq(contractorJob.status, 'booked'),
				sql`${contractorJob.expectedBackAt} is not null`,
				sql`${contractorJob.expectedBackAt} < ${Math.floor(now.getTime() / 1000)}`
			);
		case 'awaiting-invoice':
			// Donated work never gets an invoice, so it is not waiting on one.
			return and(
				eq(contractorJob.status, 'completed'),
				isNull(contractorJob.costCents),
				eq(contractorJob.isDonated, false)
			);
		case 'all':
			return undefined;
	}
}

export async function listJobs(
	opts: {
		status?: ContractorJobStatus;
		contractorId?: string;
		assetId?: string;
		workOrderId?: string;
		workOrderIds?: string[];
		view?: ContractorJobView;
		now?: Date;
	} = {}
) {
	if (opts.workOrderIds?.length === 0) return [];
	const now = opts.now ?? new Date();
	const rows = await jobRowQuery(now)
		.where(
			and(
				opts.view ? engagementViewWhere(opts.view, now) : undefined,
				opts.status ? eq(contractorJob.status, opts.status) : undefined,
				opts.contractorId ? eq(contractorJob.contractorId, opts.contractorId) : undefined,
				opts.assetId ? eq(workOrder.assetId, opts.assetId) : undefined,
				opts.workOrderId ? eq(contractorJob.workOrderId, opts.workOrderId) : undefined,
				opts.workOrderIds ? inArray(contractorJob.workOrderId, opts.workOrderIds) : undefined
			)
		)
		// Late is read soonest-promised first: the one most overdue is the first call.
		.orderBy(
			...(opts.view === 'late'
				? [asc(contractorJob.expectedBackAt)]
				: [desc(contractorJob.createdAt), desc(contractorJob.id)])
		);
	return rows.map(toJobRow);
}

/** How many engagements each filter holds, in one pass. */
export async function countJobsByView(now: Date = new Date()) {
	const count = (view: ContractorJobView) =>
		sql<number>`coalesce(sum(case when ${engagementViewWhere(view, now) ?? sql`1`} then 1 else 0 end), 0)`;
	const [row] = await db
		.select({
			open: count('open'),
			late: count('late'),
			'awaiting-invoice': count('awaiting-invoice'),
			all: sql<number>`count(*)`
		})
		.from(contractorJob);
	return row ?? { open: 0, late: 0, 'awaiting-invoice': 0, all: 0 };
}

/** Booked and past the date they promised. */
export async function listOverdueJobs(now: Date = new Date()) {
	return listJobs({ view: 'late', now });
}

/** This unit's service history, newest first. Drives the asset page's panel. */
export async function jobsForAsset(assetId: string) {
	const rows = await db
		.select({ ...engagementSelect, contractor })
		.from(contractorJob)
		.innerJoin(workOrder, eq(contractorJob.workOrderId, workOrder.id))
		.leftJoin(volunteerRole, eq(workOrder.volunteerRoleId, volunteerRole.id))
		.innerJoin(contractor, eq(contractorJob.contractorId, contractor.id))
		.where(eq(workOrder.assetId, assetId))
		.orderBy(desc(contractorJob.createdAt), desc(contractorJob.id));
	return rows.map(({ contractor: who, ...engagement }) => ({
		job: flatten(engagement),
		contractor: who
	}));
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
