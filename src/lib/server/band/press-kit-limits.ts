/**
 * How many press photos a band may hold, by tier.
 *
 * One constant, read by both the upload handler that enforces it and the editor
 * query that tells the band about it before they hit it. A second copy in the
 * UI would drift, and the drift would show up as an upload that 403s with the
 * button still saying it was allowed.
 *
 * The free allowance is one because a single good press shot is what a booker
 * actually asks for; a gallery is presentation, which is what a band site
 * buys. Raising it is this line and nothing else.
 */
export const FREE_PRESS_PHOTOS = 1;

/** `null` means uncapped — a premium band's gallery is bounded only by the per-upload limit. */
export function photoLimitForTier(tier: string): number | null {
	return tier === 'premium' ? null : FREE_PRESS_PHOTOS;
}
