import { db } from '$lib/server/db';
import { financialEntry } from '$lib/server/db/schema/financial';
import { production, productionSlot } from '$lib/server/db/schema/production';
import { eventBand } from '$lib/server/db/schema/event';
import { and, asc, eq, sum } from 'drizzle-orm';
import { deductibleTotalCents } from './expense-service';

/**
 * What a show took, what it cost, and what each act is owed.
 *
 * A worksheet, not a disbursement system — it suggests, staff decide, and no
 * money moves from here. `docs/specs/production-workflow-spec.md` § Settlement.
 */

export interface ActSettlement {
	slotId: string;
	actName: string | null;
	/** What ticket buyers designated to the acts as this act's share of the pool. */
	designatedCents: number;
	guaranteeCents: number | null;
	percentageBps: number | null;
	versus: boolean;
	againstNet: boolean;
	contributed: boolean;
	/** What the deal produces. Staff may override; nothing here pays anyone. */
	suggestedPayoutCents: number;
	/** What the collective adds on top of the designated pool to reach it. */
	topUpCents: number;
}

export interface Settlement {
	productionId: string;
	eventId: string;
	status: string;
	/** Earned by the collective — its share of tickets, already net of the acts'. */
	collectiveRevenueCents: number;
	/** What buyers set aside for the acts. The pool, and it is not a percentage. */
	actsPoolCents: number;
	expensesCents: number;
	deductibleExpensesCents: number;
	acts: ActSettlement[];
	suggestedPayoutTotalCents: number;
	/** The collective's position once the acts and the costs are paid. */
	netCents: number;
}

/**
 * A slot's payout under its own deal.
 *
 * `versus` is the industry sense: a guarantee **versus** a percentage pays the
 * greater of the two, and without it they add. `contributed` is a donated set —
 * zero and zero on purpose, which is why it cannot be inferred from the numbers.
 */
export function payoutForDeal(input: {
	guaranteeCents: number | null;
	percentageBps: number | null;
	versus: boolean;
	contributed: boolean;
	shareBaseCents: number;
}): number {
	if (input.contributed) return 0;
	const guarantee = input.guaranteeCents ?? 0;
	const percentage = input.percentageBps
		? Math.round((input.shareBaseCents * input.percentageBps) / 10_000)
		: 0;
	return input.versus ? Math.max(guarantee, percentage) : guarantee + percentage;
}

export async function getSettlement(eventId: string): Promise<Settlement | null> {
	const [prod] = await db
		.select({ id: production.id, status: production.status })
		.from(production)
		.where(eq(production.eventId, eventId))
		.limit(1);
	if (!prod) return null;

	// Revenue and pool come from the financial record rather than `payment_cache`,
	// which holds no card revenue for anything written before #837.
	const [earned] = await db
		.select({ total: sum(financialEntry.amountCents) })
		.from(financialEntry)
		.where(
			and(
				eq(financialEntry.kind, 'earned'),
				eq(financialEntry.settlementGroup, eventId),
				eq(financialEntry.category, 'ticket_sales')
			)
		);

	const [pool] = await db
		.select({ total: sum(financialEntry.amountCents) })
		.from(financialEntry)
		.where(
			and(eq(financialEntry.kind, 'pass_through'), eq(financialEntry.settlementGroup, eventId))
		);

	// Tickets record the collective's share against the ticket, not the show, so
	// the earned figure is read by category over the same group.
	const collectiveRevenueCents = Number(earned?.total ?? 0);
	const actsPoolCents = Number(pool?.total ?? 0);

	const deductibleExpensesCents = await deductibleTotalCents(prod.id);
	const [allExpenses] = await db
		.select({ total: sum(financialEntry.amountCents) })
		.from(financialEntry)
		.where(and(eq(financialEntry.kind, 'spent'), eq(financialEntry.settlementGroup, eventId)));
	const expensesCents = Math.abs(Number(allExpenses?.total ?? 0));

	const slots = await db
		.select({
			slotId: productionSlot.id,
			actName: eventBand.name,
			guaranteeCents: productionSlot.guaranteeCents,
			percentageBps: productionSlot.percentageBps,
			versus: productionSlot.versus,
			againstNet: productionSlot.againstNet,
			contributed: productionSlot.contributed
		})
		.from(productionSlot)
		.leftJoin(eventBand, eq(eventBand.id, productionSlot.eventBandId))
		.where(eq(productionSlot.productionId, prod.id))
		.orderBy(asc(productionSlot.sortOrder));

	const acts: ActSettlement[] = slots.map((s) => {
		// A gross deal divides the pool the buyers named; a net deal divides what
		// is left of it after the show's deductible costs.
		const base = s.againstNet
			? Math.max(0, actsPoolCents - deductibleExpensesCents)
			: actsPoolCents;
		const designatedCents = s.percentageBps
			? Math.round((actsPoolCents * s.percentageBps) / 10_000)
			: 0;
		const suggestedPayoutCents = payoutForDeal({
			guaranteeCents: s.guaranteeCents,
			percentageBps: s.percentageBps,
			versus: s.versus,
			contributed: s.contributed,
			shareBaseCents: base
		});
		return {
			slotId: s.slotId,
			actName: s.actName,
			designatedCents,
			guaranteeCents: s.guaranteeCents,
			percentageBps: s.percentageBps,
			versus: s.versus,
			againstNet: s.againstNet,
			contributed: s.contributed,
			suggestedPayoutCents,
			// What the collective adds beyond what arrived earmarked — a guarantee
			// on a soft night. Never negative: paying an act less than was
			// designated is not a saving, it is a different problem.
			topUpCents: Math.max(0, suggestedPayoutCents - designatedCents)
		};
	});

	const suggestedPayoutTotalCents = acts.reduce((t, a) => t + a.suggestedPayoutCents, 0);

	return {
		productionId: prod.id,
		eventId,
		status: prod.status,
		collectiveRevenueCents,
		actsPoolCents,
		expensesCents,
		deductibleExpensesCents,
		acts,
		suggestedPayoutTotalCents,
		// Expenses come out of the collective's share, not the pool — the acts'
		// number is what buyers designated. `againstNet` is the per-act exception.
		netCents: collectiveRevenueCents - expensesCents - (suggestedPayoutTotalCents - actsPoolCents)
	};
}
