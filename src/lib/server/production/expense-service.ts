import { db } from '$lib/server/db';
import { productionExpense } from '$lib/server/db/schema/production';
import { and, asc, eq, sum } from 'drizzle-orm';
import type { ProductionExpenseCategory } from '$lib/config';

/**
 * What a show cost, and the denominator a percentage-of-net deal divides against.
 *
 * `docs/specs/production-workflow-spec.md` § Production expense. Filed as #839,
 * where the promise was reaching acts before the number existed.
 */

export interface AddExpenseInput {
	productionId: string;
	label: string;
	category: ProductionExpenseCategory;
	amountCents: number;
	deductible?: boolean;
	paidTo?: string | null;
	paidAt?: Date | null;
	notes?: string | null;
	recordedByUserId?: string | null;
}

export async function addExpense(input: AddExpenseInput): Promise<string> {
	const [row] = await db
		.insert(productionExpense)
		.values({
			productionId: input.productionId,
			label: input.label,
			category: input.category,
			amountCents: input.amountCents,
			deductible: input.deductible ?? true,
			paidTo: input.paidTo ?? null,
			paidAt: input.paidAt ?? null,
			notes: input.notes ?? null,
			recordedByUserId: input.recordedByUserId ?? null
		})
		.returning({ id: productionExpense.id });
	return row.id;
}

export async function removeExpense(expenseId: string): Promise<void> {
	await db.delete(productionExpense).where(eq(productionExpense.id, expenseId));
}

/** Every line for a show, in the order they were added. */
export async function listExpenses(productionId: string) {
	return db
		.select()
		.from(productionExpense)
		.where(eq(productionExpense.productionId, productionId))
		.orderBy(asc(productionExpense.createdAt));
}

/**
 * What comes off the door before a net deal is worked out.
 *
 * Only `deductible` lines. A cost the collective carries whatever happens is
 * real spend and belongs in the financial record, but it is not the act's to
 * share — that distinction is the whole meaning of `againstNet`.
 */
export async function deductibleTotalCents(productionId: string): Promise<number> {
	const [row] = await db
		.select({ total: sum(productionExpense.amountCents) })
		.from(productionExpense)
		.where(
			and(eq(productionExpense.productionId, productionId), eq(productionExpense.deductible, true))
		);
	return Number(row?.total ?? 0);
}

/**
 * The base a slot's percentage applies to.
 *
 * `againstNet` is the only reason this is not simply the door: a gross deal
 * shares everything taken, a net deal shares what is left after the show's
 * deductible costs. Never below zero — a night that cost more than it took
 * leaves the acts a share of nothing, not a share of a negative.
 */
export async function shareBaseCents(input: {
	productionId: string;
	doorCents: number;
	againstNet: boolean;
}): Promise<number> {
	if (!input.againstNet) return Math.max(0, input.doorCents);
	const deductible = await deductibleTotalCents(input.productionId);
	return Math.max(0, input.doorCents - deductible);
}
