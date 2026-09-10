/**
 * How a ticket sale divides, and the one place that decides it.
 *
 * Client-importable on purpose — beside `fees.ts` under `$lib/finance`, not
 * under `$lib/server` — because the *same arithmetic* has to render the buyer's
 * split bar and produce the figures written onto the ticket. Two
 * implementations would eventually show a buyer one number and credit an act
 * another, which is the worst bug a split can have.
 *
 * ## What the buyer is being asked
 *
 * Three questions: how many people, how much per person, and where it goes.
 * The second is a sliding scale — `event.ticketPrice` is where it opens, not
 * what it costs — and the third is a bar the buyer drags between the acts on
 * the bill and the collective, with card processing as a locked third slice
 * taken off the top.
 *
 * ## Recorded, not routed
 *
 * Unlike a music sale, nothing here reaches Stripe as an application fee.
 * Every dollar lands in CMC's single account and the allocation is a record
 * staff settle from — an act is paid the way a contractor is. That is
 * deliberate: **no touring band should need a Stripe Connect account to get
 * paid for playing a show.** So this module produces no `applicationFeeCents`
 * and must never be made to.
 *
 * ## Why the ticket line and the contribution are separate
 *
 * The amount above the suggested price becomes the `ticket_contribution` line
 * item rather than a larger ticket price. That keeps appreciation money legible
 * in Stripe reporting, and it is what lets the webhook's receipt derivation —
 * which reconstructs fees by subtracting the ticket subtotal and the
 * contribution from Stripe's own subtotal — keep working untouched.
 */
import {
	computeSplit as computeCoreSplit,
	divisibleCents,
	otherFloorCents,
	otherTakeCents,
	suggestedShareCents,
	validateSplit as validateCoreSplit,
	type Split
} from './split';
import { TICKET_COLLECTIVE_SHARE_BPS, TICKET_MIN_CHARGE_CENTS } from '$lib/config';

export type TicketSplitInput = {
	/** What the buyer chose to pay per ticket. May be 0 on a floor-0 show. */
	unitPriceCents: number;
	quantity: number;
	/** The buyer's allocation to the collective, over the whole order. */
	collectiveCents: number;
	/** Whether the buyer is covering card processing on top. */
	coverFees: boolean;
	/** The event's suggested price — what the scale opens at. */
	suggestedUnitCents: number;
};

export type TicketSplit = {
	/** What the card is actually charged. 0 means Stripe is never involved. */
	chargeCents: number;
	stripeFeeCents: number;
	/** The buyer's gift to the collective. */
	collectiveCents: number;
	/** What is left for the bill. Derived, so the figures always reconcile. */
	actsCents: number;
	/** The surcharge, when the buyer covered fees. Zero otherwise. */
	feeCoveredCents: number;
	/** The `ticket` line item's unit price, and what lands in `unitPriceCents`. */
	ticketLineUnitCents: number;
	/** The `ticket_contribution` line item: paying above suggested IS the gift. */
	contributionCents: number;
};

/**
 * Where the bar opens: the collective's suggested share of what is divisible.
 *
 * **Prefer `actsAnchoredCollectiveCents` for a ticket.** This is the raw
 * percentage and it is proportional to what was paid, which is the behaviour
 * #827 removed: it divides a discount as well as a sale, so a NOTAFLOF buyer
 * shorts the acts rather than the collective. Kept because a caller that
 * genuinely wants a percentage of a known divisible amount still has one.
 */
export function suggestedCollectiveCents(
	divisibleCents: number,
	bps = TICKET_COLLECTIVE_SHARE_BPS
): number {
	return suggestedShareCents(divisibleCents, bps);
}

/**
 * Where the bar opens for a ticket: everything the acts are not suggested.
 *
 * The collective is the residual — it absorbs the discount when a buyer pays
 * under the suggestion, and the card fee always, until its own share is zero.
 * On a $10 show a buyer paying $7 sends $6.49 to the acts and nothing to the
 * collective.
 */
export function actsAnchoredCollectiveCents(input: {
	/** The event's suggested price for the whole order. */
	baseCents: number;
	/** What the buyer chose to pay for the whole order, before fee coverage. */
	grossPaidCents: number;
	coverFees: boolean;
	/** A buyer dragging the bar towards the acts. Never away from them. */
	actsOptUpCents?: number;
	bps?: number;
}): number {
	const { baseCents, grossPaidCents, coverFees, actsOptUpCents, bps } = input;
	const divisible = divisibleCents(grossPaidCents, coverFees);
	return (
		divisible - actsSuggestedCents({ baseCents, grossPaidCents, coverFees, actsOptUpCents, bps })
	);
}

/** The acts' opening take: their guarantee, or their ratio of the gross when it is larger. */
export function actsSuggestedCents(input: {
	baseCents: number;
	grossPaidCents: number;
	coverFees: boolean;
	actsOptUpCents?: number;
	bps?: number;
}): number {
	const {
		baseCents,
		grossPaidCents,
		coverFees,
		actsOptUpCents = 0,
		bps = TICKET_COLLECTIVE_SHARE_BPS
	} = input;
	return otherTakeCents({
		baseCents,
		grossPaidCents,
		shareBps: bps,
		divisibleCents: divisibleCents(grossPaidCents, coverFees),
		optUpCents: actsOptUpCents
	});
}

/**
 * The acts' guarantee: their share of the event's **suggested** price, clamped
 * to what is divisible. The floor the bar cannot cross.
 *
 * Deliberately not a share of what was paid. Anything above the suggestion is a
 * gift, and the bar is where the buyer says who it is for — so this does not
 * rise with generosity, and `actsOptUpCents` is not a term in it: folding a
 * buyer's own choice into the floor is what would stop them taking it back.
 */
export function actsMinCents(input: {
	baseCents: number;
	grossPaidCents: number;
	coverFees: boolean;
	bps?: number;
}): number {
	const { baseCents, grossPaidCents, coverFees, bps = TICKET_COLLECTIVE_SHARE_BPS } = input;
	return otherFloorCents({
		baseCents,
		shareBps: bps,
		divisibleCents: divisibleCents(grossPaidCents, coverFees)
	});
}

/** Split the buyer's per-ticket amount into what Stripe is sold and what is recorded. */
function lines(unitPriceCents: number, quantity: number, suggestedUnitCents: number) {
	// The ticket never costs more than the suggestion. Above it is a gift, and it
	// is an order-level one — a buyer bringing three friends is being generous
	// once, not three times, and the receipt reads that way.
	const ticketLineUnitCents = Math.min(unitPriceCents, suggestedUnitCents);
	const contributionCents = Math.max(0, unitPriceCents - suggestedUnitCents) * quantity;
	return { ticketLineUnitCents, contributionCents };
}

export function computeTicketSplit(input: TicketSplitInput): TicketSplit {
	const { unitPriceCents, quantity, collectiveCents, coverFees, suggestedUnitCents } = input;
	const totalCents = unitPriceCents * quantity;
	const core: Split = computeCoreSplit({ totalCents, shareCents: collectiveCents, coverFees });

	return {
		chargeCents: core.chargeCents,
		stripeFeeCents: core.stripeFeeCents,
		collectiveCents: core.shareCents,
		actsCents: core.remainderCents,
		feeCoveredCents: core.feeCoveredCents,
		...lines(unitPriceCents, quantity, suggestedUnitCents)
	};
}

export type TicketSplitValidation =
	{ ok: true; split: TicketSplit } | { ok: false; reason: string };

/**
 * Check a buyer's scale position and allocation, and recompute both server-side.
 *
 * **Nothing posted by the client is trusted, including the arithmetic.** The
 * caller passes the event's own suggested price and floor, which are the only
 * two figures here the buyer does not control — and they are what every other
 * number is checked against.
 */
export function validateTicketSplit(
	input: TicketSplitInput & {
		/** `event.ticketPriceFloorCents`. 0 lets the scale run to free. */
		floorCents: number;
	}
): TicketSplitValidation {
	const { unitPriceCents, quantity, collectiveCents, coverFees, suggestedUnitCents, floorCents } =
		input;

	if (!Number.isInteger(quantity) || quantity < 1) {
		return { ok: false, reason: 'Choose how many tickets you need.' };
	}

	const result = validateCoreSplit({
		totalCents: unitPriceCents * quantity,
		shareCents: collectiveCents,
		coverFees,
		// The floor is per ticket; the scale is checked over the whole order,
		// which is the same rule and the number the buyer is actually charged.
		priceMinCents: floorCents * quantity,
		minChargeCents: TICKET_MIN_CHARGE_CENTS,
		// A buyer may always pay more than suggested. That is the point.
		allowPayMore: true,
		// The acts' guarantee is a share of the suggestion, not of what was paid,
		// so the collective's ceiling is whatever sits above it. #827.
		otherMinCents: actsMinCents({
			baseCents: suggestedUnitCents * quantity,
			grossPaidCents: unitPriceCents * quantity,
			coverFees
		}),
		messages: {
			belowFloor: `The least you can pay for this show is $${(floorCents / 100).toFixed(2)} a ticket.`,
			deadZone: (min) =>
				`Pay nothing, or at least $${(min / 100).toFixed(2)} — below that, card fees take almost all of it.`,
			remainderNegative: 'That leaves the acts short.',
			shareTooLarge: 'The collective cannot take more than you paid.'
		}
	});

	if (!result.ok) return result;

	// `unitPriceCents` is not itself validated as an integer above — the order
	// total is, and a fractional unit price with an integer total is possible
	// (2 × 12.5). Catch it here, before it reaches a ticket row.
	if (!Number.isInteger(unitPriceCents)) {
		return { ok: false, reason: 'Amounts must be whole cents.' };
	}

	return {
		ok: true,
		split: {
			chargeCents: result.split.chargeCents,
			stripeFeeCents: result.split.stripeFeeCents,
			collectiveCents: result.split.shareCents,
			actsCents: result.split.remainderCents,
			feeCoveredCents: result.split.feeCoveredCents,
			...lines(unitPriceCents, quantity, suggestedUnitCents)
		}
	};
}
