// ---------------------------------------------------------------------------
// Fee calculation utilities
// ---------------------------------------------------------------------------
// Stripe charges 2.9% + 30¢ per successful card charge. When a member opts
// to cover processing fees, we need to calculate the fee on the total
// (including the fee itself), not just the base amount.
// ---------------------------------------------------------------------------

const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_CENTS = 30;

/**
 * Calculate Stripe's processing fee on a given amount.
 * Returns the fee in cents (rounded up to nearest cent).
 */
export function calculateProcessingFee(amountCents: number): number {
	if (amountCents <= 0) return 0;
	return Math.ceil(amountCents * STRIPE_PERCENT + STRIPE_FIXED_CENTS);
}

/**
 * Calculate the total charge so that after Stripe takes its fee,
 * the net received equals the base amount.
 *
 * Solves: total - (total * 0.029 + 30) = base
 *         total * (1 - 0.029) = base + 30
 *         total = (base + 30) / 0.971
 *
 * Returns the total in cents (rounded up). The fee coverage amount
 * is total - base.
 */
export function calculateTotalWithFeeCoverage(baseCents: number): {
	totalCents: number;
	feeCents: number;
} {
	if (baseCents <= 0) return { totalCents: 0, feeCents: 0 };

	const totalCents = Math.ceil((baseCents + STRIPE_FIXED_CENTS) / (1 - STRIPE_PERCENT));
	const feeCents = totalCents - baseCents;

	return { totalCents, feeCents };
}

/**
 * Stripe's in-person (card-present) rate, for a Tap to Pay sale at the door.
 * US Terminal pricing at the time of writing; confirm it against the account's
 * pricing page before the first live sale, since it is what the ledger's
 * `card_fees` row and the door screen's split both assume.
 */
const CARD_PRESENT_PERCENT = 0.027;
const CARD_PRESENT_FIXED_CENTS = 5;

export function calculateCardPresentFee(amountCents: number): number {
	if (amountCents <= 0) return 0;
	return Math.ceil(amountCents * CARD_PRESENT_PERCENT + CARD_PRESENT_FIXED_CENTS);
}
