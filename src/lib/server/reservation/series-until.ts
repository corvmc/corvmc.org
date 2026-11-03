import { DEFAULT_TIMEZONE } from '$lib/config';
import { buildDateInTz } from './timezone';

export const UNTIL_BEFORE_START = 'Pick a day after the first session.';

/**
 * A recurring booking's last day, inclusive: the series books nothing after
 * it. `undefined` is open-ended; `null` is a day on or before the first one,
 * which the booking remotes refuse before anything is written.
 */
export function recurringSeriesEnd(data: {
	recurring?: string;
	date: string;
	recurringUntil?: string;
}): Date | undefined | null {
	if (!data.recurring || !data.recurringUntil) return undefined;
	if (data.recurringUntil <= data.date) return null;
	return buildDateInTz(data.recurringUntil, '23:59', DEFAULT_TIMEZONE);
}
