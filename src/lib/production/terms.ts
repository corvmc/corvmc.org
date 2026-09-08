import { formatCents } from '$lib/utils/format';

/**
 * The deal an act is offered, in one sentence.
 *
 * Shared by the console and the band's own page so the two cannot phrase one
 * deal two ways — which is the whole point of decision 7: the protection
 * against a deal settling at the wrong number is that the act can read it.
 */

/** `{ guaranteeCents, percentageBps, versus, againstNet, contributed }`. */
export interface ActTerms {
	guaranteeCents: number | null;
	/** Basis points, so 7000 is 70%. */
	percentageBps: number | null;
	/** Pay the guarantee or the percentage, whichever is greater. */
	versus: boolean;
	/** The percentage is of net rather than of the acts' pool. */
	againstNet: boolean;
	/** Played for free, and this records what it was worth. */
	contributed: boolean;
}

export const PERCENTAGE_BPS_MAX = 10_000;

function percent(bps: number): string {
	return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

/**
 * Five shapes, from `docs/specs/project-spec.md#the-deal-shape`.
 *
 * The spec's table lists "flat fee" and "guarantee against the door" with
 * identical columns; the difference is the `versus` flag, which is what "against
 * the door" means — pay the greater of the two. A guarantee and a percentage
 * *without* it is the other real deal: a floor plus points on top.
 */
export function describeTerms(terms: ActTerms): string {
	const guarantee = terms.guaranteeCents ?? 0;
	const bps = terms.percentageBps ?? 0;
	const pool = terms.againstNet ? 'of net' : "of the acts' pool";

	if (terms.contributed) return 'Donated set';
	if (guarantee > 0 && bps > 0) {
		return `${formatCents(guarantee)} ${terms.versus ? 'versus' : 'plus'} ${percent(bps)} ${pool}`;
	}
	if (guarantee > 0) return `${formatCents(guarantee)} flat`;
	if (bps > 0) return `${percent(bps)} ${pool}`;
	return 'No terms agreed yet';
}
