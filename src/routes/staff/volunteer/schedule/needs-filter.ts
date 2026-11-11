import { m } from '#lib/paraglide/messages.js';

/**
 * The Schedule's queues, once the dashboard's cards (#2379). Each narrows the
 * table; `ended` swaps it for tasks whose shifts are over, which are past any
 * window the table could show.
 */
export const NEEDS = {
	claims: m.staff_volunteer_needs_confirming_card_title_text,
	short: m.staff_volunteer_short_staffed_card_title_text,
	unassigned: m.staff_volunteer_unassigned_tasks_title,
	ended: m.staff_volunteer_ended_shifts_title
} as const;
export type Needs = keyof typeof NEEDS | '';

export const parseNeeds = (raw: string | null): Needs =>
	raw && Object.hasOwn(NEEDS, raw) ? (raw as Needs) : '';
