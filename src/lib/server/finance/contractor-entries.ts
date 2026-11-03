import type { RecordEntryInput } from './financial-entry-service';

/**
 * What a finished contractor job did to the collective's position.
 *
 * Two mutually exclusive outcomes, and the service already enforces that:
 * a job is either paid for or donated, never both, because `getProjectBurn`
 * would otherwise count it as money spent *and* as value contributed.
 */
interface CompletedJob {
	jobId: string;
	/** The work order's title. */
	title: string;
	/** The work order's project, which the entry is booked against. */
	projectId?: string | null;
	occurredAt: Date;
	costCents?: number | null;
	isDonated: boolean;
	fairValueCents?: number | null;
}

/** What the ledger already holds for one job: paid out, and given in kind. */
export interface BookedForJob {
	paidCents: number;
	donatedCents: number;
}

/** Sums a job's ledger rows into what `completedJobEntries` compares against. */
export function bookedForJob(rows: { kind: string; amountCents: number }[]): BookedForJob {
	let paidCents = 0;
	let donatedCents = 0;
	for (const r of rows) {
		if (r.kind === 'spent') paidCents -= r.amountCents;
		else if (r.kind === 'in_kind') donatedCents += r.amountCents;
	}
	return { paidCents, donatedCents };
}

/**
 * What completing a job books: the difference from what the ledger already
 * holds for it. That is everything on a first completion; on a re-completion
 * after a reopen (#2259) it keeps the job from being counted twice, because
 * the ledger is append-only and reopening never reverses it.
 */
export function completedJobEntries(
	params: CompletedJob,
	booked: BookedForJob = { paidCents: 0, donatedCents: 0 }
): RecordEntryInput[] {
	const donatedDelta = (params.isDonated ? (params.fairValueCents ?? 0) : 0) - booked.donatedCents;
	const paidDelta = (params.isDonated ? 0 : (params.costCents ?? 0)) - booked.paidCents;

	const entries: RecordEntryInput[] = [];
	if (donatedDelta !== 0) {
		entries.push({
			amountCents: donatedDelta,
			kind: 'in_kind',
			category: 'donation',
			occurredAt: params.occurredAt,
			settlement: 'none',
			subjectType: 'contractor_job',
			subjectId: params.jobId,
			projectId: params.projectId ?? null,
			description: `Donated work — ${params.title}`
		});
	}
	if (paidDelta !== 0) entries.push(paidEntry(params, paidDelta, `Contractor — ${params.title}`));
	return entries;
}

/**
 * The cost of an invoice that arrived after the job was completed, as the
 * difference from what completion already booked — the ledger is append-only.
 */
export function lateInvoiceEntries(
	params: Omit<CompletedJob, 'costCents' | 'isDonated' | 'fairValueCents'> & {
		bookedCents: number | null;
		invoicedCents: number | null;
	}
): RecordEntryInput[] {
	const delta = (params.invoicedCents ?? 0) - (params.bookedCents ?? 0);
	if (delta === 0) return [];
	return [paidEntry(params, delta, `Contractor invoice — ${params.title}`)];
}

function paidEntry(
	params: Pick<CompletedJob, 'jobId' | 'projectId' | 'occurredAt'>,
	paid: number,
	description: string
): RecordEntryInput {
	return {
		// Negative: money out. The sign is what makes a sum a position.
		amountCents: -paid,
		kind: 'spent',
		category: 'contractor',
		occurredAt: params.occurredAt,
		// The transfer happens outside the app, as `reimbursedAt` does.
		settlement: 'none',
		subjectType: 'contractor_job',
		subjectId: params.jobId,
		projectId: params.projectId ?? null,
		description
	};
}
