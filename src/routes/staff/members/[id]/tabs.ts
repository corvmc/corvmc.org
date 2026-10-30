/**
 * Tab vocabulary for the staff user record, shared with the panels so an
 * Overview "jump" cannot name a tab that does not exist. One-word labels.
 *
 * No feature-flag gating: staff surfaces ignore flags (`getStaffLayout`), so an
 * off program shows an empty section here rather than vanishing.
 */
export const TAB_KEYS = [
	'overview',
	'space',
	'bands',
	'volunteer',
	'instructor',
	'money',
	'comms',
	'moderation',
	'account'
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
	overview: 'Overview',
	space: 'Space',
	bands: 'Bands',
	volunteer: 'Volunteer',
	instructor: 'Instructor',
	money: 'Money',
	comms: 'Comms',
	moderation: 'Moderation',
	account: 'Account'
};

/** Unknown or absent falls back to the default rather than blanking the page. */
export function parseTab(raw: string | null): TabKey {
	return TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'overview';
}
