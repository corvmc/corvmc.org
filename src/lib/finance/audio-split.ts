/**
 * How a music sale divides, and the one place that decides it.
 *
 * Client-importable on purpose — this module sits beside `fees.ts` under
 * `$lib/finance`, not under `$lib/server` — because the *same arithmetic* has to
 * render the buyer's split bar and produce the `application_fee_amount` handed
 * to Stripe. Two implementations would eventually show a buyer one figure and
 * pay the band another, which is the single worst bug this feature could have.
 *
 * ## The model
 *
 * The collective's cut is the **default position of a slider, not a rake**. The
 * buyer names a total and may drag the division between the band and CMC. The
 * band's floor is what the band asked for. CMC's floor is zero, and zero is
 * genuinely allowed: at that position `application_fee_amount` is exactly
 * Stripe's fee, so the collective nets nothing and — this is the part that makes
 * it safe to offer — loses nothing.
 *
 * ## Why the application fee includes Stripe's cut
 *
 * These are Connect **destination charges**, so Stripe bills the *platform* for
 * processing. The platform receives `application_fee_amount` and pays the fee
 * out of it. Setting the app fee to CMC's share alone would leave CMC netting
 * $0.41 on a $10 sale instead of $1.00 — the fee has to be added on top, which
 * is what makes the band bear processing when the buyer declines to.
 */
import { calculateProcessingFee, calculateTotalWithFeeCoverage } from './fees';
import { AUDIO_PLATFORM_FEE_BPS, AUDIO_MIN_PRICE_CENTS } from '$lib/config';

export type SplitInput = {
	/** What the buyer chose to pay, before optional fee coverage. */
	totalCents: number;
	/** The buyer's allocation to the collective, in cents. May be 0. */
	platformCents: number;
	/** Whether the buyer is covering card processing on top. */
	coverFees: boolean;
};

export type Split = {
	/** What the card is actually charged. */
	chargeCents: number;
	/** What Stripe takes from the platform. */
	stripeFeeCents: number;
	/** The buyer's gift to the collective — CMC's net, after the fee passes through. */
	platformCents: number;
	/** `transfer_data` sends this to the band. */
	bandCents: number;
	/** What Stripe is told: `platformCents + stripeFeeCents`. */
	applicationFeeCents: number;
	/** The surcharge, when the buyer covered fees. Zero otherwise. */
	feeCoveredCents: number;
};

/** Where the split bar opens: CMC's suggested share of the buyer's total. */
export function suggestedPlatformCents(totalCents: number, bps = AUDIO_PLATFORM_FEE_BPS): number {
	if (totalCents <= 0) return 0;
	return Math.round((totalCents * bps) / 10000);
}

/**
 * Resolve a complete split from an allocation.
 *
 * Total in, four numbers out, and they always reconcile: the band's share is
 * whatever is left of the charge after Stripe and the collective, so nothing can
 * round its way into a gap.
 */
export function computeSplit({ totalCents, platformCents, coverFees }: SplitInput): Split {
	if (totalCents <= 0) {
		return {
			chargeCents: 0,
			stripeFeeCents: 0,
			platformCents: 0,
			bandCents: 0,
			applicationFeeCents: 0,
			feeCoveredCents: 0
		};
	}

	const chargeCents = coverFees ? calculateTotalWithFeeCoverage(totalCents).totalCents : totalCents;
	const stripeFeeCents = calculateProcessingFee(chargeCents);
	const applicationFeeCents = platformCents + stripeFeeCents;

	return {
		chargeCents,
		stripeFeeCents,
		platformCents,
		// Derived rather than computed independently, so the four figures always
		// add up to the charge exactly — a separate calculation would leave a cent
		// unaccounted for on some inputs and nowhere to put it.
		bandCents: chargeCents - applicationFeeCents,
		applicationFeeCents,
		feeCoveredCents: chargeCents - totalCents
	};
}

/** The split the bar opens at, for a given total. */
export function defaultSplit(totalCents: number, coverFees = false): Split {
	return computeSplit({
		totalCents,
		platformCents: suggestedPlatformCents(totalCents),
		coverFees
	});
}

export type SplitValidation = { ok: true; split: Split } | { ok: false; reason: string };

/**
 * Check a buyer's allocation against the release, and recompute it server-side.
 *
 * **Nothing posted by the client is trusted, including the arithmetic.** These
 * numbers become `application_fee_amount`; a client that sent a platform share
 * of `-500` would be paying itself out of the band's money. The caller passes
 * the release's own floor, which is the only figure here the buyer does not
 * control.
 */
export function validateSplit(input: {
	totalCents: number;
	platformCents: number;
	coverFees: boolean;
	priceMinCents: number;
	allowPayMore: boolean;
}): SplitValidation {
	const { totalCents, platformCents, coverFees, priceMinCents, allowPayMore } = input;

	if (!Number.isInteger(totalCents) || !Number.isInteger(platformCents)) {
		return { ok: false, reason: 'Amounts must be whole cents.' };
	}
	if (totalCents < 0 || platformCents < 0) {
		return { ok: false, reason: 'Amounts cannot be negative.' };
	}

	// A free release: nothing to divide, and no charge to make.
	if (priceMinCents === 0 && totalCents === 0) {
		return { ok: true, split: computeSplit({ totalCents: 0, platformCents: 0, coverFees: false }) };
	}

	if (totalCents < priceMinCents) {
		return { ok: false, reason: 'That is less than the band asked for.' };
	}
	if (!allowPayMore && totalCents !== priceMinCents) {
		return { ok: false, reason: 'This release has a fixed price.' };
	}
	// The dead zone between free and Stripe's own charge minimum.
	if (totalCents > 0 && totalCents < AUDIO_MIN_PRICE_CENTS) {
		return {
			ok: false,
			reason: `Pay nothing, or at least $${(AUDIO_MIN_PRICE_CENTS / 100).toFixed(2)}.`
		};
	}

	const split = computeSplit({ totalCents, platformCents, coverFees });

	// The band's floor, restated as the invariant that actually protects it: the
	// allocation must not push the band below what it asked for. This is the
	// check that stops a buyer dragging the collective's share up to the whole
	// sale — the bar's UI prevents it, and the UI is not the guard.
	if (split.bandCents < 0) {
		return { ok: false, reason: 'That leaves the band nothing.' };
	}
	if (platformCents > totalCents) {
		return { ok: false, reason: 'The collective cannot take more than the total.' };
	}

	return { ok: true, split };
}
