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
 * ## Processing comes out of the collective's share
 *
 * These are Connect **destination charges**, so Stripe bills the *platform* for
 * processing. `application_fee_amount` is therefore CMC's share and nothing
 * more: the band is transferred exactly what the split bar allocates it, and
 * the card fee is deducted from what reaches CMC.
 *
 * That is a deliberate choice about who absorbs a cost neither party controls,
 * and it has one hard consequence — **CMC's share cannot go below the
 * processing fee**, or the collective pays for the privilege of selling
 * somebody else's record. So the floor on that segment is the fee, not zero.
 * Refusing the collective's cut still means dragging it all the way down; it
 * just bottoms out at break-even instead of at nothing.
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
	/** The buyer's allocation to the collective, before its share of the fee. */
	platformCents: number;
	/** The band's portion of the card fee. Zero when the buyer covers fees. */
	bandFeeCents: number;
	/** The collective's portion of the card fee — the remainder, so nothing is lost. */
	platformFeeShareCents: number;
	/** What the collective actually keeps, after its portion of the fee. */
	platformNetCents: number;
	/** `transfer_data` sends this to the band: its allocation less its fee share. */
	bandCents: number;
	/** What Stripe is told: whatever is left of the charge once the band is paid. */
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
			bandFeeCents: 0,
			platformFeeShareCents: 0,
			platformNetCents: 0,
			bandCents: 0,
			applicationFeeCents: 0,
			feeCoveredCents: 0
		};
	}

	const chargeCents = coverFees ? calculateTotalWithFeeCoverage(totalCents).totalCents : totalCents;
	const stripeFeeCents = calculateProcessingFee(chargeCents);
	const feeCoveredCents = chargeCents - totalCents;

	/** The allocation itself, before either side pays anything toward the fee. */
	const bandShareCents = totalCents - platformCents;

	/**
	 * The band's portion of the card fee, in proportion to its share.
	 *
	 * Zero when the buyer covers fees — the surcharge has already paid for it, so
	 * both sides keep their whole allocation, which is the entire point of the
	 * checkbox. The collective's portion is never computed directly: it falls out
	 * as the remainder, which is what stops a rounded half-cent going missing.
	 */
	const bandFeeCents =
		coverFees || totalCents === 0 ? 0 : Math.round((stripeFeeCents * bandShareCents) / totalCents);

	const bandCents = bandShareCents - bandFeeCents;

	return {
		chargeCents,
		stripeFeeCents,
		platformCents,
		bandFeeCents,
		platformFeeShareCents: stripeFeeCents - bandFeeCents,
		bandCents,
		// Whatever is left of the charge once the band has been paid. Derived
		// rather than computed independently, so band + application fee is exactly
		// the charge and no cent can fall between them.
		applicationFeeCents: chargeCents - bandCents,
		platformNetCents: chargeCents - bandCents - stripeFeeCents,
		feeCoveredCents
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

	// Processing comes out of the collective's share, so anything below the fee
	// is CMC paying to sell somebody else's record. The bar clamps to this floor;
	// the UI is not the guard.
	if (split.platformNetCents < 0) {
		return { ok: false, reason: 'That would cost the collective money on the sale.' };
	}
	// Stops a buyer dragging the collective's share up to the whole sale. `<= 0`
	// rather than `< 0`: a paid release that pays the band exactly nothing is not
	// a sale anybody meant to make.
	if (split.bandCents <= 0) {
		return { ok: false, reason: 'That leaves the band nothing.' };
	}

	return { ok: true, split };
}
