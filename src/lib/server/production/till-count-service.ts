import { db } from '#lib/server/db/index.js';
import { production, productionTillCount } from '#lib/server/db/schema/production.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, eq } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { assertNotTerminal } from './production-scope';
import { ProductionNotFoundError } from './production-service';
import { tillSummary } from './till-summary';

/**
 * The door cash, counted at each handoff and again by staff (#3273).
 *
 * Nothing here refuses a count for who made it: a till counted by one person
 * is a warning, recorded on the settlement as `oneCounter`. What refuses is a
 * show already closed or cancelled.
 */

export class TillCountNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That till count is no longer on the show.');
	}
}

async function assertProductionExists(productionId: string): Promise<void> {
	const [prod] = await db
		.select({ id: production.id })
		.from(production)
		.where(eq(production.id, productionId))
		.limit(1);
	if (!prod) throw new ProductionNotFoundError();
}

/** One count at a handoff: whoever held the till says what was in it. */
export async function recordHandoff(
	productionId: string,
	actorUserId: string,
	cashCents: number
): Promise<string> {
	await assertNotTerminal({ productionId });
	await assertProductionExists(productionId);

	const [row] = await db
		.insert(productionTillCount)
		.values({
			productionId,
			kind: 'handoff',
			cashCents,
			countedByUserId: actorUserId,
			countedAt: new Date()
		})
		.returning({ id: productionTillCount.id });
	return row.id;
}

/** The show and the counter of a handoff, so a caller guards on the row and not on a form field. */
export async function handoffOwner(countId: string): Promise<{
	productionId: string;
	countedByUserId: string | null;
	counterName: string | null;
	cashCents: number;
} | null> {
	const [row] = await db
		.select({
			productionId: productionTillCount.productionId,
			countedByUserId: productionTillCount.countedByUserId,
			counterName: user.name,
			cashCents: productionTillCount.cashCents
		})
		.from(productionTillCount)
		.leftJoin(user, eq(user.id, productionTillCount.countedByUserId))
		.where(and(eq(productionTillCount.id, countId), eq(productionTillCount.kind, 'handoff')))
		.limit(1);
	return row ?? null;
}

export async function removeHandoff(countId: string): Promise<void> {
	const handoff = await handoffOwner(countId);
	if (!handoff) throw new TillCountNotFoundError();
	await assertNotTerminal({ productionId: handoff.productionId });
	await db.delete(productionTillCount).where(eq(productionTillCount.id, countId));
	await recordAuditEntry({
		action: 'production.till_count_removed',
		subject: { type: 'production', id: handoff.productionId },
		details: { cashCents: handoff.cashCents, counterName: handoff.counterName }
	});
}

/**
 * The staff count, with the headcount and the split it is entered beside.
 *
 * The staff row is replaced in one batch with the production's two figures, so
 * a failure leaves the old count rather than none. A null cash clears it:
 * "nobody counted" is not a zero.
 */
export async function recordStaffCount(
	productionId: string,
	actorUserId: string,
	input: { cashCents: number | null; count: number | null; splitActsPercent: number | null }
): Promise<void> {
	await assertNotTerminal({ productionId });
	await assertProductionExists(productionId);

	const before = await tillSummary(productionId);
	const now = new Date();
	const clear = db
		.delete(productionTillCount)
		.where(
			and(eq(productionTillCount.productionId, productionId), eq(productionTillCount.kind, 'staff'))
		);
	const figures = db
		.update(production)
		.set({ doorCount: input.count, doorSplitActsPercent: input.splitActsPercent, updatedAt: now })
		.where(eq(production.id, productionId));

	if (input.cashCents === null) {
		await db.batch([clear, figures]);
		return;
	}
	await db.batch([
		clear,
		figures,
		db.insert(productionTillCount).values({
			productionId,
			kind: 'staff',
			cashCents: input.cashCents,
			countedByUserId: actorUserId,
			countedAt: now
		})
	]);

	if (before.handoffTotalCents !== null && before.handoffTotalCents !== input.cashCents) {
		await recordAuditEntry({
			action: 'production.door_recounted',
			subject: { type: 'production', id: productionId },
			details: { firstCents: before.handoffTotalCents, secondCents: input.cashCents }
		});
	}
}
