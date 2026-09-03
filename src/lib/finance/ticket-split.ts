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
 * Where the bar opens: the collective's suggested share.
 *
 * Pass the charge *minus* the card fee — what the two parties actually divide.
 * 30% of the gross is not 30% of anything anyone receives.
 */
export function suggestedCollectiveCents(
	divisibleCents: number,
	bps = TICKET_COLLECTIVE_SHARE_BPS
): number {
	return suggestedShareCents(divisibleCents, bps);
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
		messages: {
			belowFloor: `The least you can pay for this show is $${(floorCents / 100).toFixed(2)} a ticket.`,
			deadZone: (min) =>
				`Pay nothing, or at least $${(min / 100).toFixed(2)} — below that, card fees take almost all of it.`,
			remainderNegative: 'That leaves the acts nothing.',
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
