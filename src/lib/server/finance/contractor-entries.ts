import { recordEntry } from './financial-entry-service';

/**
 * What a finished contractor job did to the collective's position.
 *
 * Two mutually exclusive outcomes, and the service already enforces that:
 * a job is either paid for or donated, never both, because `getProjectBurn`
 * would otherwise count it as money spent *and* as value contributed.
 */
export async function recordCompletedJob(params: {
	jobId: string;
	summary: string;
	projectId?: string | null;
	occurredAt: Date;
	costCents?: number | null;
	isDonated: boolean;
	fairValueCents?: number | null;
}): Promise<void> {
	const donatedValue = params.isDonated ? (params.fairValueCents ?? 0) : 0;
	const paid = params.isDonated ? 0 : (params.costCents ?? 0);

	if (donatedValue > 0) {
		await recordEntry({
			amountCents: donatedValue,
			kind: 'in_kind',
			category: 'donation',
			occurredAt: params.occurredAt,
			settlement: 'none',
			subjectType: 'contractor_job',
			subjectId: params.jobId,
			projectId: params.projectId ?? null,
			description: `Donated work — ${params.summary}`
		});
		return;
	}

	if (paid <= 0) return;

	await recordEntry({
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
		description: `Contractor — ${params.summary}`
	});
}
