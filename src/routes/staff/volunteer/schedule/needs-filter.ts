import { m } from '#lib/paraglide/messages.js';

/**
 * The Schedule's work-order queues, once the dashboard's cards (#2379). Each
 * narrows the table; `confirm` swaps it for finished repairs, which are past
 * any window the table could show.
 */
export const NEEDS = {
	claims: m.staff_volunteer_needs_confirming_card_title_text,
	short: m.staff_volunteer_short_staffed_card_title_text,
	unscheduled: m.staff_volunteer_needs_scheduling_card_title_text,
	confirm: m.staff_volunteer_confirm_fixed_card_title_body
} as const;
export type Needs = keyof typeof NEEDS | '';

export const parseNeeds = (raw: string | null): Needs =>
	raw && Object.hasOwn(NEEDS, raw) ? (raw as Needs) : '';
