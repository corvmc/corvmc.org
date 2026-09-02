import { db } from '$lib/server/db';
import { contractor } from '$lib/server/db/schema/contractor';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import type { ContractorTrade } from '$lib/config';

/**
 * The people the collective pays to do work.
 *
 * Thin on purpose. A contractor is a name, a trade and a way to reach them; the
 * interesting object is the job, and everything a report wants to know — what we
 * spent, who was last in, what is overdue — is a question about jobs that
 * happens to group by this table.
 */

export class ContractorNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Contractor not found');
	}
}

export interface ContractorInput {
	name: string;
	trade: ContractorTrade;
	contactName?: string | null;
	phone?: string | null;
	email?: string | null;
	website?: string | null;
	licenseNumber?: string | null;
	insuranceExpiresAt?: Date | null;
	notes?: string | null;
}

export async function createContractor(data: ContractorInput) {
	const [row] = await db.insert(contractor).values(data).returning();
	return row;
}

export async function updateContractor(id: string, data: Partial<ContractorInput>) {
	await getContractorById(id);

	const [row] = await db
		.update(contractor)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(contractor.id, id))
		.returning();

	return row;
}

/**
 * Retire someone from the pickers without pretending they never worked here.
 *
 * `contractor_job.contractor_id` restricts deletion, so this is the only way out
 * for anyone with history — and the history is the point of the table.
 */
export async function archiveContractor(id: string, archived = true) {
	await getContractorById(id);

	const [row] = await db
		.update(contractor)
		.set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
		.where(eq(contractor.id, id))
		.returning();

	return row;
}

export async function getContractorById(id: string) {
	const [row] = await db.select().from(contractor).where(eq(contractor.id, id)).limit(1);
	if (!row) throw new ContractorNotFoundError();
	return row;
}

export async function listContractors(
	opts: { trade?: ContractorTrade; includeArchived?: boolean } = {}
) {
	return db
		.select()
		.from(contractor)
		.where(
			and(
				opts.trade ? eq(contractor.trade, opts.trade) : undefined,
				opts.includeArchived ? undefined : isNull(contractor.archivedAt)
			)
		)
		.orderBy(asc(contractor.name));
}

/**
 * Whose certificate of insurance has lapsed, or lapses within `days`.
 *
 * Derived from the date every time rather than stored, following
 * `member_certification`: there is no status to go stale, and nothing has to run
 * on a schedule to keep the answer true. Contractors we hold no certificate for
 * are **not** included — null is "we never asked", which is a different problem
 * from "it ran out" and wants a different prompt.
 */
export async function listLapsingInsurance(days = 30, now: Date = new Date()) {
	const horizon = new Date(now.getTime() + days * 86_400_000);

	return db
		.select()
		.from(contractor)
		.where(
			and(
				isNull(contractor.archivedAt),
				sql`${contractor.insuranceExpiresAt} is not null`,
				sql`${contractor.insuranceExpiresAt} <= ${Math.floor(horizon.getTime() / 1000)}`
			)
		)
		.orderBy(asc(contractor.insuranceExpiresAt));
}
