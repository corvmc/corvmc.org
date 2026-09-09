/**
 * Tab vocabulary for the production console.
 *
 * Overview carries everything about the night itself — the listing's own fields,
 * the poster, the room, and the production record. Advance is the work owed
 * before doors: riders in, shifts filled. Run of show is who plays when.
 * Tickets is the money coming in; Settlement is what the night owes. Close-out
 * is still to come, which is why `collapse` is on the bar: six tabs outrun a
 * phone.
 */
export const TAB_KEYS = ['overview', 'advance', 'runOfShow', 'tickets', 'settlement'] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
	overview: 'Overview',
	advance: 'Advance',
	runOfShow: 'Run of show',
	tickets: 'Tickets',
	settlement: 'Settlement'
};

/** Unknown or absent falls back to the default rather than blanking the page. */
export function parseTab(raw: string | null): TabKey {
	return TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'overview';
}
