import { m } from '#lib/paraglide/messages.js';

export type Frequency = 'weekly' | 'biweekly' | 'monthly';

/**
 * The one label for each repeat frequency. Every picker that offers the choice
 * renders these, so the same choice cannot read two ways (#3088);
 * frequency-options.spec.ts fails on a picker that labels a frequency itself.
 */
export const FREQUENCY_LABELS: Record<Frequency, () => string> = {
	weekly: m.recurrence_weekly_label,
	biweekly: m.recurrence_biweekly_label,
	monthly: m.recurrence_monthly_label
};

export function frequencyOptions(): { value: Frequency; label: string }[] {
	return (Object.keys(FREQUENCY_LABELS) as Frequency[]).map((value) => ({
		value,
		label: FREQUENCY_LABELS[value]()
	}));
}
