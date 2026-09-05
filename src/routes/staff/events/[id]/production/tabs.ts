/**
 * Tab vocabulary for the production console.
 *
 * Three now; Phase 3 adds Run of show, Phase 5 Settlement and Phase 6
 * Close-out. `collapse` is on the bar from the start for that reason — six tabs
 * outrun a phone, and the prop costs nothing today.
 *
 * Overview carries everything about the night itself — the listing's own fields,
 * the poster, the room, and the production record. Advance is the work owed
 * before doors: riders in, shifts filled. Tickets is the money.
 */
export const TAB_KEYS = ['overview', 'advance', 'tickets'] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
	overview: 'Overview',
	advance: 'Advance',
	tickets: 'Tickets'
};

/** Unknown or absent falls back to the default rather than blanking the page. */
export function parseTab(raw: string | null): TabKey {
	return TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'overview';
}
