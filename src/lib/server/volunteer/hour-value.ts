import { config } from '$lib/server/site-config/site-config-service';
import { valueOfMinutesCents } from '$lib/config';

/**
 * What donated time was worth — **two numbers that are never added together**.
 *
 * `impactValueCents` covers every approved hour at the Independent Sector rate;
 * `recognizableServicesCents` covers only hours under an `is_specialized_skill`
 * role at that role's own rate. They overlap by construction, so summing them
 * double-counts and is wrong for both audiences. Hence no total field.
 */
export interface ContributedValue {
	totalMinutes: number;
	specializedMinutes: number;
	/** Every approved minute, at the site rate. */
	impactValueCents: number;
	/** Specialized minutes only, each at its own role's market rate. */
	recognizableServicesCents: number;
	/**
	 * Minutes worked under a specialized role that has no `market_rate_cents`.
	 *
	 * These contribute **zero** to `recognizableServicesCents` rather than
	 * falling back to the site rate — that fallback is exactly the merge of the
	 * two columns this module exists to prevent. Surfaced so a report can say
	 * the number is incomplete instead of quietly understating it.
	 */
	unpricedSpecializedMinutes: number;
	/** The site rate used, and where it came from, for the report to cite. */
	rateCents: number;
	rateSource: string;
}

/** The impact rate: what one donated hour is worth for grant and impact reporting. */
export async function getHourValueCents(): Promise<number> {
	return config<number>('volunteer.hourValueCents');
}

/** Where that rate came from, so a funder-facing number can cite itself. */
export async function getHourValueSource(): Promise<string> {
	return config<string>('volunteer.hourValueSource');
}

/**
 * Minute totals in, both valuations out.
 *
 * Pure: the caller supplies totals its own query computed, so this imposes no
 * opinion about ranges or joins. `specializedValueCents` is summed per role by
 * the caller because each specialized role carries its own rate — there is no
 * single multiplier that would work.
 */
export async function toContributedValue(totals: {
	totalMinutes: number;
	specializedMinutes: number;
	unpricedSpecializedMinutes: number;
	specializedValueCents: number;
}): Promise<ContributedValue> {
	const [rateCents, rateSource] = await Promise.all([getHourValueCents(), getHourValueSource()]);

	return {
		totalMinutes: totals.totalMinutes,
		specializedMinutes: totals.specializedMinutes,
		impactValueCents: valueOfMinutesCents(totals.totalMinutes, rateCents),
		recognizableServicesCents: totals.specializedValueCents,
		unpricedSpecializedMinutes: totals.unpricedSpecializedMinutes,
		rateCents,
		rateSource
	};
}
