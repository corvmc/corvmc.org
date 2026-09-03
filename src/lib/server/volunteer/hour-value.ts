import { config } from '$lib/server/site-config/site-config-service';
import { valueOfMinutesCents } from '$lib/config';

/**
 * What donated time was worth — as **two numbers that are never added
 * together**.
 *
 * `impactValueCents` covers every approved hour at the Independent Sector rate
 * in site config. It is the figure grant applications, impact reports and board
 * packets ask for, and it has no eligibility test.
 *
 * `recognizableServicesCents` covers only hours worked under a role marked
 * `is_specialized_skill`, each at that role's own `market_rate_cents`. It is
 * the narrower figure a financial statement can recognise under FASB, and it
 * exists only because the collective would otherwise have had to buy the skill.
 *
 * The two overlap by construction: a donated audio engineer's hour is in both.
 * Summing them therefore double-counts that hour, and produces a figure that is
 * wrong for both audiences — which is why this shape has **no total field**.
 * There is nothing here to add up.
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
 * Pure: the caller supplies the totals its own query already computed, so this
 * imposes no opinion about ranges, filters or joins and can serve the volunteer
 * report and a project's burn alike.
 *
 * `specializedValueCents` is summed per role by the caller rather than derived
 * here, because each specialized role carries its own rate — there is no single
 * multiplier that would work.
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
