import { db } from '#lib/server/db/index.js';
import { production } from '#lib/server/db/schema/production.js';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { assertNotTerminal } from './production-scope';
import { ProductionNotFoundError } from './production-service';

/**
 * The end-of-night drawer, counted twice by two different people (#2722).
 *
 * A single count or two counts that disagree are warnings, shown on the
 * settlement and at close; neither refuses. What refuses is one person
 * holding both counts, since a second count by the first counter is no check.
 */

export class SameCounterError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('The second count has to be made by somebody other than the first counter.');
	}
}

export class DoorNotCountedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('Record the first count before a second one.');
	}
}

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * The first count, with the headcount and the split.
 *
 * The counter is restamped only when the cash figure changes, so editing the
 * split does not make somebody the counter. Clearing the cash clears the
 * second count with it: a confirmation of nothing is not kept.
 */
export async function recordDoorTake(
	productionId: string,
	actorUserId: string,
	input: { cashCents: number | null; count: number | null; splitActsPercent: number | null }
): Promise<void> {
	await assertNotTerminal({ productionId });
	const now = new Date();
	const base = {
		doorCashCents: input.cashCents,
		doorCount: input.count,
		doorSplitActsPercent: input.splitActsPercent,
		updatedAt: now
	};

	if (input.cashCents === null) {
		const rows = await db
			.update(production)
			.set({
				...base,
				doorCashCountedByUserId: null,
				doorCashCountedAt: null,
				doorCashRecountCents: null,
				doorCashRecountedByUserId: null,
				doorCashRecountedAt: null
			})
			.where(eq(production.id, productionId))
			.returning({ id: production.id });
		if (rows.length === 0) throw new ProductionNotFoundError();
		return;
	}

	// SQLite reads the old row on the right of every SET, so `changed` compares
	// against the figure being replaced. The WHERE refuses the second counter
	// rewriting the first count in the same statement as the check.
	const changed = sql`${production.doorCashCents} is not ${input.cashCents}`;
	const rows = await db
		.update(production)
		.set({
			...base,
			doorCashCountedByUserId: sql`case when ${changed} then ${actorUserId} else ${production.doorCashCountedByUserId} end`,
			doorCashCountedAt: sql`case when ${changed} then ${seconds(now)} else ${production.doorCashCountedAt} end`
		})
		.where(
			and(
				eq(production.id, productionId),
				sql`(not (${changed}) or ${production.doorCashRecountedByUserId} is not ${actorUserId})`
			)
		)
		.returning({ id: production.id });
	if (rows.length === 0) await explainRefusal(productionId);
}

/** The second count. `null` takes it back. */
export async function recordDoorRecount(
	productionId: string,
	actorUserId: string,
	cashCents: number | null
): Promise<void> {
	await assertNotTerminal({ productionId });
	const now = new Date();

	if (cashCents === null) {
		const rows = await db
			.update(production)
			.set({
				doorCashRecountCents: null,
				doorCashRecountedByUserId: null,
				doorCashRecountedAt: null,
				updatedAt: now
			})
			.where(eq(production.id, productionId))
			.returning({ id: production.id });
		if (rows.length === 0) throw new ProductionNotFoundError();
		return;
	}

	const [row] = await db
		.update(production)
		.set({
			doorCashRecountCents: cashCents,
			doorCashRecountedByUserId: actorUserId,
			doorCashRecountedAt: now,
			updatedAt: now
		})
		.where(
			and(
				eq(production.id, productionId),
				isNotNull(production.doorCashCents),
				sql`${production.doorCashCountedByUserId} is not ${actorUserId}`
			)
		)
		.returning({ firstCents: production.doorCashCents });
	if (!row) return explainRefusal(productionId);

	await recordAuditEntry({
		action: 'production.door_recounted',
		subject: { type: 'production', id: productionId },
		details: { firstCents: row.firstCents ?? 0, secondCents: cashCents }
	});
}

/** Why a guarded update matched no row, read after the fact. */
async function explainRefusal(productionId: string): Promise<never> {
	const [row] = await db
		.select({ first: production.doorCashCents })
		.from(production)
		.where(eq(production.id, productionId))
		.limit(1);
	if (!row) throw new ProductionNotFoundError();
	if (row.first === null) throw new DoorNotCountedError();
	throw new SameCounterError();
}
