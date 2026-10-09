import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import {
	production,
	productionExpense,
	productionSlot,
	type Production
} from '$lib/server/db/schema/production';
import { artifactRequest } from '$lib/server/db/schema/artifact-request';
import { DomainError } from '$lib/server/domain-error';
import { isTerminalProduction } from '$lib/production/status';

/**
 * The project a production guard resolves committees against, read off the
 * record being acted on — never off an id the request supplied beside it.
 *
 * Null when the record does not exist or names no project: the guard then
 * falls to staff cover, and the service reports the missing row itself.
 */

export async function projectOfProduction(productionId: string): Promise<string | null> {
	const [row] = await db
		.select({ projectId: production.projectId })
		.from(production)
		.where(eq(production.id, productionId))
		.limit(1);
	return row?.projectId ?? null;
}

/** The stored row, for a guard comparing a submission against it. Null when there is none. */
export async function currentProduction(productionId: string): Promise<Production | null> {
	const [row] = await db.select().from(production).where(eq(production.id, productionId)).limit(1);
	return row ?? null;
}

export async function projectOfSlot(slotId: string): Promise<string | null> {
	const [row] = await db
		.select({ projectId: production.projectId })
		.from(productionSlot)
		.innerJoin(production, eq(production.id, productionSlot.productionId))
		.where(eq(productionSlot.id, slotId))
		.limit(1);
	return row?.projectId ?? null;
}

export async function projectOfExpense(expenseId: string): Promise<string | null> {
	const [row] = await db
		.select({ projectId: production.projectId })
		.from(productionExpense)
		.innerJoin(production, eq(production.id, productionExpense.productionId))
		.where(eq(productionExpense.id, expenseId))
		.limit(1);
	return row?.projectId ?? null;
}

/** A listing's project, and whether it announces a production at all. */
export async function projectOfEvent(
	eventId: string
): Promise<{ projectId: string | null; productionId: string | null } | null> {
	const [row] = await db
		.select({ projectId: eventListing.projectId, productionId: eventListing.productionId })
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	return row ?? null;
}

export async function projectOfArtifactRequest(requestId: string): Promise<string | null> {
	const [row] = await db
		.select({ projectId: eventListing.projectId })
		.from(artifactRequest)
		.innerJoin(eventListing, eq(eventListing.id, artifactRequest.eventId))
		.where(eq(artifactRequest.id, requestId))
		.limit(1);
	return row?.projectId ?? null;
}

/** 409: the show is closed or cancelled, and only an admin reopen takes it back. */
export class ProductionTerminalError extends DomainError {
	readonly httpStatus = 409;
	constructor(status: string) {
		super(`This show is ${status}. An admin has to reopen it before it can change.`);
		this.name = 'ProductionTerminalError';
	}
}

export type ProductionTarget =
	{ productionId: string } | { slotId: string } | { expenseId: string } | { eventId: string };

/**
 * Refuse a write to a show in a terminal state.
 *
 * Every production write path calls this first. A target that names no
 * production — a missing row, a listing with no show — passes, and the write
 * reports its own 404.
 */
export async function assertNotTerminal(target: ProductionTarget): Promise<void> {
	const status = await statusOf(target);
	if (status && isTerminalProduction(status)) throw new ProductionTerminalError(status);
}

async function statusOf(target: ProductionTarget) {
	const q = db.select({ status: production.status });
	if ('productionId' in target) {
		const [row] = await q.from(production).where(eq(production.id, target.productionId)).limit(1);
		return row?.status;
	}
	if ('slotId' in target) {
		const [row] = await q
			.from(productionSlot)
			.innerJoin(production, eq(production.id, productionSlot.productionId))
			.where(eq(productionSlot.id, target.slotId))
			.limit(1);
		return row?.status;
	}
	if ('expenseId' in target) {
		const [row] = await q
			.from(productionExpense)
			.innerJoin(production, eq(production.id, productionExpense.productionId))
			.where(eq(productionExpense.id, target.expenseId))
			.limit(1);
		return row?.status;
	}
	const [row] = await q
		.from(eventListing)
		.innerJoin(production, eq(production.id, eventListing.productionId))
		.where(eq(eventListing.id, target.eventId))
		.limit(1);
	return row?.status;
}
