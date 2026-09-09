import { BRAND } from './brand';
import type { NotificationCategoryKey } from '$lib/server/db/schema/notification';

// ---------------------------------------------------------------------------
// Notification categories
// ---------------------------------------------------------------------------
// Every notification email carries a short colour bar above its heading saying
// which part of the Collective it is about. Five buckets is what this palette
// can colour apart; notification-category.spec.ts measures that.
// ---------------------------------------------------------------------------

// Only three brand colours clear 3:1 against BOTH the cream and the dark
// surface, so one hex per category cannot work. `light` and `dark` are both
// existing BRAND values, following the swaps the layout already makes for
// teal, navy and orange.

export interface NotificationCategory {
	/** Shown in the preheader and the text part — the non-colour half of the signal. */
	label: string;
	/** Bar fill on the cream surface. */
	light: string;
	/** Bar fill on the dark surface, applied by a class in the layout's dark block. */
	dark: string;
	/** Class the layout's dark block keys the `dark` fill off. */
	className: string;
}

export const NOTIFICATION_CATEGORIES: Record<NotificationCategoryKey, NotificationCategory> = {
	// The room and the gear at 6775 SW Philomath — including the first visit,
	// which is a booking with somebody meeting you at it.
	'practice-space': {
		label: 'Practice space',
		light: BRAND.teal,
		dark: BRAND.dark.teal,
		className: 'kicker-practice-space'
	},
	// Anything that ends in an audience: tickets, bills, and the public calendar.
	shows: {
		label: 'Shows & tickets',
		light: BRAND.redOrange,
		dark: BRAND.redOrange,
		className: 'kicker-shows'
	},
	// Money and the account it belongs to.
	membership: {
		label: 'Membership & billing',
		light: BRAND.orange,
		dark: BRAND.orangeSoft,
		className: 'kicker-membership'
	},
	// Somebody is trying to reach you — a band, a member, staff, or a group.
	people: {
		label: 'People & messages',
		light: BRAND.goldenrod,
		dark: BRAND.goldenrod,
		className: 'kicker-people'
	},
	// Time you give the Collective, and what you put up for review.
	volunteering: {
		label: 'Volunteering & community',
		light: BRAND.navy,
		dark: BRAND.dark.text,
		className: 'kicker-volunteering'
	}
};

/**
 * Bar stroke. It is the stroke, not the fill, that makes the bar an object the
 * eye can find: 9.54:1 on cream and 3.30:1 on the dark surface, where three of
 * the five fills are under 3:1 against one surface or the other. Same two
 * values `.pass-card` already uses.
 */
export const CATEGORY_BAR_STROKE = { light: BRAND.brown, dark: BRAND.dark.stroke } as const;
