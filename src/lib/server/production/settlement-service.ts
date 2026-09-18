import { db } from '$lib/server/db';
import { announcedBy } from './production-service';
import { financialEntry } from '$lib/server/db/schema/financial';
import { production, productionSlot } from '$lib/server/db/schema/production';
import { eventBand, eventListing } from '$lib/server/db/schema/event';
import { and, asc, eq, sum } from 'drizzle-orm';
import { DOOR_SPLIT_ACTS_PERCENT } from '$lib/config';
import { expenseLines, type ProductionExpenseLine } from './expense-service';
import { recordActPayout } from '$lib/server/finance/payout-entries';
import { DomainError } from '$lib/server/domain-error';

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
	/** What the act was actually handed. Null is unpaid; 0 is a paid nothing. */
	paidCents: number | null;
	paidAt: Date | null;
}

/** The drawer count, and the split applied to it. */
export interface DoorTake {
	cashCents: number;
	count: number | null;
	/** The percentage actually used — this show's override, or the house rule. */
	actsPercent: number;
	actsCents: number;
	collectiveCents: number;
	/** True when this night departed from `DOOR_SPLIT_ACTS_PERCENT`. */
	overridden: boolean;
}

export interface Settlement {
	productionId: string;
	eventId: string;
	status: string;
	/**
	 * Earned by the collective — its share of tickets, already net of the acts',
	 * plus its share of the door (#929).
	 */
	collectiveRevenueCents: number;
	/**
	 * What the acts are owed from: what buyers designated to them, plus their
	 * share of undesignated door cash. `door` below breaks out the second part.
	 */
	actsPoolCents: number;
	/**
	 * The night's cash, and how it split. Absent until somebody counts the
	 * drawer — a show with no door take is not a show with a zero (#929).
	 */
	door: DoorTake | null;
	expensesCents: number;
	deductibleExpensesCents: number;
	/** The cost sheet behind those two totals, so the worksheet can show it. */
	expenses: ProductionExpenseLine[];
	acts: ActSettlement[];
	suggestedPayoutTotalCents: number;
	/** What has actually gone out so far. */
	paidTotalCents: number;
	/** Acts with no payout recorded yet — what settling still has left to do. */
	unpaidActCount: number;
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

/**
 * How one night's door cash divides.
 *
 * Null when nobody has counted — which is not the same as a zero, and the
 * worksheet says so. Rounding favours the acts: the collective keeps the
 * remainder, because a cent lost to rounding is the house's to absorb.
 */
export function splitDoorTake(input: {
	doorCashCents: number | null;
	doorCount: number | null;
	doorSplitActsPercent: number | null;
}): DoorTake | null {
	if (input.doorCashCents === null) return null;

	const actsPercent = input.doorSplitActsPercent ?? DOOR_SPLIT_ACTS_PERCENT;
	const actsCents = Math.round((input.doorCashCents * actsPercent) / 100);

	return {
		cashCents: input.doorCashCents,
		count: input.doorCount,
		actsPercent,
		actsCents,
		collectiveCents: input.doorCashCents - actsCents,
		overridden: input.doorSplitActsPercent !== null
	};
}

export async function getSettlement(eventId: string): Promise<Settlement | null> {
	const [prod] = await db
		.select({
			id: production.id,
			status: production.status,
			doorCashCents: production.doorCashCents,
			doorCount: production.doorCount,
			doorSplitActsPercent: production.doorSplitActsPercent
		})
		.from(production)
		.where(announcedBy(eventId))
		.limit(1);
	if (!prod) return null;

	const door = splitDoorTake(prod);

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
	// Door cash joins both sides rather than sitting beside them: the acts are
	// owed from the whole pool, and a deal against net is measured against it.
	// The `door` breakdown is what lets the worksheet show where it came from.
	const collectiveRevenueCents = Number(earned?.total ?? 0) + (door?.collectiveCents ?? 0);
	const actsPoolCents = Number(pool?.total ?? 0) + (door?.actsCents ?? 0);

	// The show's own cost sheet, not the ledger's `spent` rows. Those also carry
	// the guarantee top-ups that `netCents` subtracts below as the gap between
	// suggested payouts and the pool, so reading them here charged a soft night
	// twice. The spec names `production_expense` as the expense total.
	const expenses = await expenseLines(prod.id);
	const expensesCents = expenses.reduce((t, e) => t + e.amountCents, 0);
	const deductibleExpensesCents = expenses.reduce(
		(t, e) => (e.deductible ? t + e.amountCents : t),
		0
	);

	const slots = await db
		.select({
			slotId: productionSlot.id,
			actName: eventBand.name,
			guaranteeCents: productionSlot.guaranteeCents,
			percentageBps: productionSlot.percentageBps,
			versus: productionSlot.versus,
			againstNet: productionSlot.againstNet,
			contributed: productionSlot.contributed,
			paidCents: productionSlot.paidCents,
			paidAt: productionSlot.paidAt
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
			topUpCents: Math.max(0, suggestedPayoutCents - designatedCents),
			paidCents: s.paidCents,
			paidAt: s.paidAt
		};
	});

	const suggestedPayoutTotalCents = acts.reduce((t, a) => t + a.suggestedPayoutCents, 0);
	const paidTotalCents = acts.reduce((t, a) => t + (a.paidCents ?? 0), 0);
	// A `contributed` set still has to be marked paid — at zero. Otherwise a
	// donated night reads as permanently outstanding.
	const unpaidActCount = acts.filter((a) => a.paidCents === null).length;

	return {
		productionId: prod.id,
		eventId,
		status: prod.status,
		collectiveRevenueCents,
		actsPoolCents,
		door,
		expensesCents,
		deductibleExpensesCents,
		expenses,
		acts,
		suggestedPayoutTotalCents,
		paidTotalCents,
		unpaidActCount,
		// Expenses come out of the collective's share, not the pool — the acts'
		// number is what buyers designated. `againstNet` is the per-act exception.
		netCents: collectiveRevenueCents - expensesCents - (suggestedPayoutTotalCents - actsPoolCents)
	};
}

export class PayoutError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'PayoutError';
	}
}

/**
 * Record what an act was handed.
 *
 * The amount is staff's, not the worksheet's: `suggestedPayoutCents` is what
 * the deal produces, and a settlement is a conversation at the end of the
 * night. Writes the slot's record and the ledger's together.
 */
export async function recordSlotPayout(
	slotId: string,
	amountCents: number,
	recordedByUserId: string
): Promise<void> {
	if (!Number.isInteger(amountCents) || amountCents < 0) {
		throw new PayoutError('A payout is a whole number of cents, and not negative.');
	}

	const [slot] = await db
		.select({
			id: productionSlot.id,
			paidCents: productionSlot.paidCents,
			productionId: production.id,
			eventId: eventListing.id,
			status: production.status,
			actName: eventBand.name
		})
		.from(productionSlot)
		.innerJoin(production, eq(production.id, productionSlot.productionId))
		// The listing is where the event id lives now: a production no longer
		// carries its own advertisement's id (#1202).
		.innerJoin(eventListing, eq(eventListing.productionId, production.id))
		.leftJoin(eventBand, eq(eventBand.id, productionSlot.eventBandId))
		.where(eq(productionSlot.id, slotId))
		.limit(1);

	if (!slot) throw new PayoutError('That slot is no longer on the bill.');
	// Closed is terminal. Re-opening a settled night to change a number is a
	// correction, and a correction is a reversing entry rather than an edit.
	if (slot.status === 'closed') {
		throw new PayoutError('This show is closed. Reopen it before changing what was paid.');
	}
	if (slot.paidCents !== null) {
		throw new PayoutError('That act is already marked paid.');
	}

	const now = new Date();
	await db
		.update(productionSlot)
		.set({ paidCents: amountCents, paidAt: now, paidByUserId: recordedByUserId, updatedAt: now })
		.where(eq(productionSlot.id, slotId));

	await recordActPayout({
		eventId: slot.eventId,
		productionId: slot.productionId,
		slotId,
		actName: slot.actName ?? 'the act',
		amountCents,
		occurredAt: now,
		recordedByUserId
	});
}
