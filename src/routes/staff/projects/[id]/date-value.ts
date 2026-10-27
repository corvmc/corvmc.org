import { toLocalDate } from '$lib/utils/format';

/**
 * A date input wants `YYYY-MM-DD` in venue time, because the save path reads it
 * back as a venue day. A UTC slice moves an evening-Pacific date forward a day.
 */
export const asDateValue = (d: Date | null) => (d ? toLocalDate(d) : '');
