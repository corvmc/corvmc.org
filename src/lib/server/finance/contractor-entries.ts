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

/** What completing a job books: nothing, one paid entry, or one donated. */
export function completedJobEntries(params: CompletedJob): RecordEntryInput[] {
	const donatedValue = params.isDonated ? (params.fairValueCents ?? 0) : 0;
	const paid = params.isDonated ? 0 : (params.costCents ?? 0);

	if (donatedValue > 0) {
		return [
			{
				amountCents: donatedValue,
				kind: 'in_kind',
				category: 'donation',
				occurredAt: params.occurredAt,
				settlement: 'none',
				subjectType: 'contractor_job',
				subjectId: params.jobId,
				projectId: params.projectId ?? null,
				description: `Donated work — ${params.title}`
			}
		];
	}

	if (paid <= 0) return [];

	return [paidEntry(params, paid, `Contractor — ${params.title}`)];
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
