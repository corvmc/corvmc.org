/**
 * Tab vocabulary for the staff user record.
 *
 * Shared between the page and the panels so a "jump to the tab that owns this"
 * button on Overview cannot name a tab that does not exist.
 *
 * Labels are kept to one word wherever the tab bar allows it. Eight tabs of
 * "Space & Gear" and "Bands & Shows" outrun a phone even collapsed, and the
 * ampersand halves were never what anyone scanned for.
 *
 * No feature-flag gating: `getStaffLayout` records the panel-wide rule that
 * staff surfaces ignore flags, so an off program shows an empty section here
 * rather than vanishing.
 */
export const TAB_KEYS = [
	'overview',
	'space',
	'bands',
	'volunteer',
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
	money: 'Money',
	comms: 'Comms',
	moderation: 'Moderation',
	account: 'Account'
};

/** Unknown or absent falls back to the default rather than blanking the page. */
export function parseTab(raw: string | null): TabKey {
	return TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'overview';
}
