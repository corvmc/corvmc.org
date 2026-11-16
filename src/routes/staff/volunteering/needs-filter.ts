import { m } from '#lib/paraglide/messages.js';

/**
 * Volunteering's queues (#2625). The first two narrow the table; `ended` swaps
 * it for tasks whose shifts are over, which are past any window the table
 * could show. Unassigned tasks are Tasks' chip now.
 */
export const NEEDS = {
	claims: m.staff_volunteer_needs_confirming_card_title_label,
	short: m.staff_volunteer_short_staffed_card_title_label,
	ended: m.staff_volunteer_ended_shifts_label
} as const;
export type Needs = keyof typeof NEEDS | '';

export const parseNeeds = (raw: string | null): Needs =>
	raw && Object.hasOwn(NEEDS, raw) ? (raw as Needs) : '';
