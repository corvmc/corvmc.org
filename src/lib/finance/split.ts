/**
 * How a payment divides between two parties, and the one place that decides it.
 *
 * Client-importable on purpose — this module sits beside `fees.ts` under
 * `$lib/finance`, not under `$lib/server` — because the *same arithmetic* has to
 * render the buyer's split bar and produce the figures the server records or
 * hands to Stripe. Two implementations would eventually show a buyer one number
 * and pay a band another, which is the single worst bug a split can have.
 *
 * ## The model
 *
 * The collective's cut is the **default position of a slider, not a rake**. The
 * buyer names a total and may drag the division. Card processing is a third
 * party to that division, taken off the top: what the slider divides is the
 * charge minus Stripe's fee, so neither share is quietly funding the card
 * network. The share this module allocates has a floor of zero, and zero is
 * genuinely allowed — that is what makes it an ask rather than a rake.
 *
 * ## What is deliberately not here
 *
 * `application_fee_amount` — a Stripe Connect destination-charge concept, and
 * only correct where there is a connected account to send money to. It lives in
 * `audio-split.ts`, the Connect-shaped adapter. Ticket money is recorded, not
 * routed, and handing Stripe an application fee on a ticket checkout would be a
 * bug; keeping the term out of the shared core is what stops someone reaching
 * for it.
 */
import { calculateProcessingFee, calculateTotalWithFeeCoverage } from './fees';

export type SplitInput = {
	/** What the buyer chose to pay, before optional fee coverage. */
	totalCents: number;
	/** The buyer's allocation to the party the slider names. May be 0. */
	shareCents: number;
	/** Whether the buyer is covering card processing on top. */
	coverFees: boolean;
};

export type Split = {
	/** What the card is actually charged. */
	chargeCents: number;
	/** What Stripe takes — the fixed third slice of the bar. */
	stripeFeeCents: number;
	/** The allocated share, exactly as the slider reports it. */
	shareCents: number;
	/** Everything left over: the other party's take. */
	remainderCents: number;
	/** The surcharge, when the buyer covered fees. Zero otherwise. */
	feeCoveredCents: number;
};

/**
 * Where a bar opens: a share of what is actually divisible.
 *
 * Pass the amount the two parties are dividing — the charge *minus* the card
 * fee — not the gross. A percentage of the gross reads as the share it names
 * but is not, because the fee comes out before anyone is paid.
 */
export function suggestedShareCents(divisibleCents: number, bps: number): number {
	if (divisibleCents <= 0) return 0;
	return Math.round((divisibleCents * bps) / 10000);
}

/**
 * What the two parties actually divide: the charge, less the card fee.
 *
 * Exported because the allocation has to be decided *before* `computeSplit`
 * runs — the ceiling on either share is this number, and a caller that
 * recomputed it would eventually disagree by a cent.
 */
export function divisibleCents(totalCents: number, coverFees: boolean): number {
	if (totalCents <= 0) return 0;
	const charge = coverFees ? calculateTotalWithFeeCoverage(totalCents).totalCents : totalCents;
	return charge - calculateProcessingFee(charge);
}

/**
 * The least the other party may be left with: their share of the **base rate**,
 * and nothing to do with what the buyer paid.
 *
 * A proportional split divides a discount as well as a sale, so a buyer paying
 * under the sticker price would short the other party rather than the one
 * offering the discount. Anchoring to the base fixes that in both directions:
 * money above the sticker price is a gift, and a gift the buyer cannot direct
 * is not one.
 *
 * `min(divisibleCents, …)` is the clamp, and it is why paying $7 on a $10 show
 * leaves $6.49 rather than a $7 that does not exist.
 */
export function otherFloorCents(input: {
	/** The sticker price for the whole order — what the floor is anchored to. */
	baseCents: number;
	/** The allocating party's share, in basis points. */
	shareBps: number;
	/** What is left after the card fee. */
	divisibleCents: number;
}): number {
	const { baseCents, shareBps, divisibleCents } = input;
	if (divisibleCents <= 0) return 0;
	return Math.min(divisibleCents, Math.round((baseCents * (10000 - shareBps)) / 10000));
}

/**
 * Where the bar opens: the other party's floor, or their share of the gross
 * when the buyer paid over the sticker price, whichever is larger.
 *
 * This is a suggestion, not the limit — `otherFloorCents` is the limit. The
 * surplus above the base opens split at the same ratio, and the buyer may move
 * it either way until one share or the other runs out.
 */
export function otherTakeCents(input: {
	/** The sticker price for the whole order — what the share is anchored to. */
	baseCents: number;
	/** What the buyer chose to pay, before any fee coverage. */
	grossPaidCents: number;
	/** The allocating party's share, in basis points. */
	shareBps: number;
	/** What is left after the card fee. */
	divisibleCents: number;
	/** A buyer's deliberate increase. Never a decrease. */
	optUpCents?: number;
}): number {
	const { baseCents, grossPaidCents, shareBps, divisibleCents, optUpCents = 0 } = input;
	if (divisibleCents <= 0) return 0;
	// Built on the floor rather than beside it, so a take can never land under
	// the number the validator holds the same allocation to.
	const floor = otherFloorCents({ baseCents, shareBps, divisibleCents });
	const ofGross = Math.round((grossPaidCents * (10000 - shareBps)) / 10000);
	return Math.min(divisibleCents, Math.max(floor, ofGross, optUpCents));
}

/**
 * Resolve a complete split from an allocation.
 *
 * Total in, four numbers out, and they always reconcile: the remainder is
 * whatever is left of the charge after Stripe and the allocated share, so
 * nothing can round its way into a gap.
 */
export function computeSplit({ totalCents, shareCents, coverFees }: SplitInput): Split {
	if (totalCents <= 0) {
		return {
			chargeCents: 0,
			stripeFeeCents: 0,
			shareCents: 0,
			remainderCents: 0,
			feeCoveredCents: 0
		};
	}

	const chargeCents = coverFees ? calculateTotalWithFeeCoverage(totalCents).totalCents : totalCents;
	const stripeFeeCents = calculateProcessingFee(chargeCents);

	return {
		chargeCents,
		stripeFeeCents,
		shareCents,
		// Derived rather than computed independently, so the three figures always
		// add up to the charge exactly — a separate calculation would leave a cent
		// unaccounted for on some inputs and nowhere to put it.
		remainderCents: chargeCents - shareCents - stripeFeeCents,
		feeCoveredCents: chargeCents - totalCents
	};
}

export type SplitValidation = { ok: true; split: Split } | { ok: false; reason: string };

/** Overridable copy, so an adapter can speak its own domain's language. */
export type SplitMessages = {
	notWhole?: string;
	negative?: string;
	belowFloor?: string;
	fixedPrice?: string;
	deadZone?: (minChargeCents: number) => string;
	remainderNegative?: string;
	shareTooLarge?: string;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Check a buyer's allocation, and recompute it server-side.
 *
 * **Nothing posted by the client is trusted, including the arithmetic.** A
 * client that sent a share of `-500` would be paying one party out of the
 * other's money. The caller passes the floor and the charge minimum, which are
 * the only figures here the buyer does not control.
 */
export function validateSplit(input: {
	totalCents: number;
	shareCents: number;
	coverFees: boolean;
	/** The least this sale may total. `0` means it may be free. */
	priceMinCents: number;
	/** Below this, and above zero, card fees eat almost everything. */
	minChargeCents: number;
	allowPayMore: boolean;
	/**
	 * The least the other party may be left with, already clamped to what is
	 * divisible — see `otherFloorCents`. Defaults to `0`, which is the old
	 * behaviour: an allocation may take everything.
	 */
	otherMinCents?: number;
	messages?: SplitMessages;
}): SplitValidation {
	const {
		totalCents,
		shareCents,
		coverFees,
		priceMinCents,
		minChargeCents,
		allowPayMore,
		otherMinCents = 0
	} = input;
	const m = input.messages ?? {};

	if (!Number.isInteger(totalCents) || !Number.isInteger(shareCents)) {
		return { ok: false, reason: m.notWhole ?? 'Amounts must be whole cents.' };
	}
	if (totalCents < 0 || shareCents < 0) {
		return { ok: false, reason: m.negative ?? 'Amounts cannot be negative.' };
	}

	// Free, and nothing to divide: no charge to make either.
	if (priceMinCents === 0 && totalCents === 0) {
		return { ok: true, split: computeSplit({ totalCents: 0, shareCents: 0, coverFees: false }) };
	}

	if (totalCents < priceMinCents) {
		return { ok: false, reason: m.belowFloor ?? 'That is less than the asking price.' };
	}
	if (!allowPayMore && totalCents !== priceMinCents) {
		return { ok: false, reason: m.fixedPrice ?? 'This has a fixed price.' };
	}
	// The dead zone between free and the charge minimum.
	if (totalCents > 0 && totalCents < minChargeCents) {
		return {
			ok: false,
			reason: m.deadZone?.(minChargeCents) ?? `Pay nothing, or at least ${dollars(minChargeCents)}.`
		};
	}

	const split = computeSplit({ totalCents, shareCents, coverFees });

	// The other party's protection. `otherMinCents` is their anchored take, so an
	// allocation may reduce the allocating party's own share to nothing and never
	// theirs. The bar's UI clamps to the same number, and the UI is not the guard.
	if (split.remainderCents < otherMinCents) {
		return { ok: false, reason: m.remainderNegative ?? 'That leaves the other party short.' };
	}
	if (shareCents > split.chargeCents) {
		return { ok: false, reason: m.shareTooLarge ?? 'A share cannot exceed the total.' };
	}

	return { ok: true, split };
}
