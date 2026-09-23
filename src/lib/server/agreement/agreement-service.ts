import { db } from '$lib/server/db';
import { agreement, type Agreement, type NewAgreement } from '$lib/server/db/schema/agreement';
import { eq, inArray } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { openAgreementStatuses, type AgreementDeadlineKind } from '$lib/config';

export class AgreementNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Agreement not found');
	}
}

export interface AgreementDeadline {
	kind: AgreementDeadlineKind;
	/** `YYYY-MM-DD` */
	on: string;
	overdue: boolean;
}

type DeadlineInput = Pick<Agreement, 'status' | 'applyBy' | 'endsOn' | 'reportDueOn'>;

/**
 * What comes due next, from the row and today's `YYYY-MM-DD`. ISO dates compare
 * correctly as strings, so no parsing. A missed date stays the deadline, overdue,
 * until someone moves the status on.
 */
export function nextDeadline(a: DeadlineInput, today: string): AgreementDeadline | null {
	const at = (kind: AgreementDeadlineKind, on: string): AgreementDeadline => ({
		kind,
		on,
		overdue: on < today
	});

	if (a.status === 'prospect') return a.applyBy ? at('apply', a.applyBy) : null;
	if (a.status !== 'active') return null;

	const report = a.reportDueOn ? at('report', a.reportDueOn) : null;
	const end = a.endsOn ? at('end', a.endsOn) : null;
	if (report && end) return report.on <= end.on ? report : end;
	return report ?? end;
}

export type AgreementRow = Agreement & { deadline: AgreementDeadline | null };

export async function listAgreements(opts: {
	today: string;
	includeClosed?: boolean;
}): Promise<AgreementRow[]> {
	const query = db.select().from(agreement).$dynamic();
	const rows = opts.includeClosed
		? await query
		: await query.where(inArray(agreement.status, [...openAgreementStatuses]));

	return rows
		.map((row) => ({ ...row, deadline: nextDeadline(row, opts.today) }))
		.sort((a, b) => {
			if (a.deadline && b.deadline) return a.deadline.on.localeCompare(b.deadline.on);
			if (a.deadline) return -1;
			if (b.deadline) return 1;
			return a.counterparty.localeCompare(b.counterparty);
		});
}

export async function getAgreement(id: string): Promise<Agreement> {
	const [row] = await db.select().from(agreement).where(eq(agreement.id, id)).limit(1);
	if (!row) throw new AgreementNotFoundError();
	return row;
}

export type AgreementInput = Omit<NewAgreement, 'id' | 'createdAt' | 'updatedAt'>;

export async function createAgreement(input: AgreementInput): Promise<Agreement> {
	const [row] = await db.insert(agreement).values(input).returning();
	return row;
}

export async function updateAgreement(id: string, input: AgreementInput): Promise<void> {
	const rows = await db
		.update(agreement)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(agreement.id, id))
		.returning({ id: agreement.id });
	if (rows.length === 0) throw new AgreementNotFoundError();
}

export async function deleteAgreement(id: string): Promise<void> {
	const rows = await db
		.delete(agreement)
		.where(eq(agreement.id, id))
		.returning({ id: agreement.id });
	if (rows.length === 0) throw new AgreementNotFoundError();
}
