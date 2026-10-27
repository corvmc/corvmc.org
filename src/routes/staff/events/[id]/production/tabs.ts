/**
 * Tab vocabulary for the production console, which is back-of-house only: the
 * listing's own fields, poster, room and sale are `/staff/events/[id]`'s.
 * Overview is the production record; Advance is the work owed before doors;
 * Run of show is who plays when; Settlement is what the night owes.
 */
export const TAB_KEYS = ['overview', 'advance', 'runOfShow', 'settlement'] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
	overview: 'Overview',
	advance: 'Advance',
	runOfShow: 'Run of show',
	settlement: 'Settlement'
};

/** Unknown or absent falls back to the default rather than blanking the page. */
export function parseTab(raw: string | null): TabKey {
	return TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'overview';
}
