/**
 * How a music sale divides — the Connect-shaped adapter over `split.ts`.
 *
 * The arithmetic of dividing a payment between two parties is not specific to
 * music, and it lives in `./split.ts`. What is specific to music is that the
 * money is *routed* rather than merely recorded: these are Stripe Connect
 * **destination charges**, so the band's share leaves CMC's balance and lands
 * in the band's own account. That routing needs two figures the shared core has
 * no business knowing — `transfer_data.destination`'s amount and
 * `application_fee_amount` — and this module is the only place they are named.
 *
 * Client-importable on purpose, like `split.ts` and `fees.ts`, because the same
 * arithmetic has to render the buyer's split bar and produce the figure handed
 * to Stripe. Two implementations would eventually show a buyer one number and
 * pay a band another, which is the single worst bug this feature could have.
 *
 * ## The model
 *
 * The collective's cut is the **default position of a slider, not a rake**. The
 * buyer names a total and may drag the division between the band and CMC. The
 * floor on CMC's share is zero, and zero is genuinely allowed — that is what
 * makes it an ask rather than a rake.
 *
 * Card processing is a third party to that division, taken off the top: what
 * the slider divides is the charge *minus* Stripe's fee. Both sides therefore
 * fund processing in proportion to what they take, and a buyer who drags CMC to
 * nothing leaves the collective with no share of the fee either — so refusing
 * the cut costs CMC nothing rather than costing it money. That property is why
 * this needs no minimum share to be safe.
 */
import { computeSplit, validateSplit as validateShare, suggestedShareCents } from './split';
import type { Split } from './split';
import { AUDIO_PLATFORM_FEE_BPS, AUDIO_MIN_PRICE_CENTS } from '$lib/config';

export type AudioSplit = Split & {
	/** What `transfer_data` sends to the band: the remainder of the division. */
	bandCents: number;
	/** What the collective keeps, once card processing has taken its share. */
	platformNetCents: number;
	/**
	 * What Stripe is told. Whatever is left of the charge once the band is paid
	 * — derived rather than computed independently, so the band's transfer and
	 * the application fee are exactly the charge and no cent falls between them.
	 */
	applicationFeeCents: number;
};

const toAudio = (split: Split): AudioSplit => ({
	...split,
	bandCents: split.remainderCents,
	platformNetCents: split.shareCents,
	applicationFeeCents: split.chargeCents - split.remainderCents
});

/**
 * What is actually divisible: the charge, less the card fee.
 *
 * The suggested share is a percentage of *this*, not of the gross. A percentage
 * of the gross reads as the share it names but is not, because processing comes
 * out before either party is paid.
 */
export function divisibleCents(totalCents: number, coverFees = false): number {
	const { chargeCents, stripeFeeCents } = computeSplit({ totalCents, shareCents: 0, coverFees });
	return Math.max(0, chargeCents - stripeFeeCents);
}

/** Where the split bar opens: CMC's suggested share, net of processing. */
export function suggestedPlatformCents(totalCents: number, coverFees = false): number {
	return suggestedShareCents(divisibleCents(totalCents, coverFees), AUDIO_PLATFORM_FEE_BPS);
}

/** Resolve a complete sale from the buyer's allocation to the collective. */
export function computeAudioSplit(input: {
	totalCents: number;
	platformCents: number;
	coverFees: boolean;
}): AudioSplit {
	return toAudio(
		computeSplit({
			totalCents: input.totalCents,
			shareCents: input.platformCents,
			coverFees: input.coverFees
		})
	);
}

/** The split the bar opens at, for a given total. */
export function defaultSplit(totalCents: number, coverFees = false): AudioSplit {
	return computeAudioSplit({
		totalCents,
		platformCents: suggestedPlatformCents(totalCents, coverFees),
		coverFees
	});
}

export type SplitValidation = { ok: true; split: AudioSplit } | { ok: false; reason: string };

/**
 * Check a buyer's allocation against the release, and recompute it server-side.
 *
 * **Nothing posted by the client is trusted, including the arithmetic.** These
 * numbers become `application_fee_amount`; a client that sent a platform share
 * of `-500` would be paying itself out of the band's money. The release's own
 * floor is the one figure here the buyer does not control.
 */
export function validateSplit(input: {
	totalCents: number;
	platformCents: number;
	coverFees: boolean;
	priceMinCents: number;
	allowPayMore: boolean;
}): SplitValidation {
	const result = validateShare({
		totalCents: input.totalCents,
		shareCents: input.platformCents,
		coverFees: input.coverFees,
		priceMinCents: input.priceMinCents,
		minChargeCents: AUDIO_MIN_PRICE_CENTS,
		allowPayMore: input.allowPayMore,
		messages: {
			belowFloor: 'That is less than the band asked for.',
			fixedPrice: 'This release has a fixed price.',
			remainderNegative: 'That leaves the band nothing.',
			shareTooLarge: 'That leaves the band nothing.'
		}
	});
	if (!result.ok) return result;

	const split = toAudio(result.split);

	// A paid sale that transfers the band exactly nothing is not a sale anybody
	// meant to make. The shared core stops at *negative*, which is the invariant
	// it can state without knowing there is a band on the other end.
	if (split.chargeCents > 0 && split.bandCents <= 0) {
		return { ok: false, reason: 'That leaves the band nothing.' };
	}

	return { ok: true, split };
}
