import { untrack } from 'svelte';
import { inboxChannels, inboxViews, type InboxView } from '$lib/config';

type InboxChannel = (typeof inboxChannels)[number];

/**
 * The queue's filter state, shared by the list pane and the filter panel.
 *
 * Module-level rather than owned by the list, because the panel that edits
 * these renders in the *other* pane — the list has to stay visible while you
 * narrow it, so the two are siblings under the layout rather than parent and
 * child. Both are mounted by `+layout.svelte`, which outlives every thread you
 * open, so the state's lifetime already matches the layout's.
 *
 * Seeded from the query string and mirrored back into it, so opening a thread
 * and pressing back lands on the same filtered view. Local state rather than
 * reading `page.url` back: a filter change re-renders immediately instead of
 * waiting on the navigation that records it.
 */

export type QueueFilters = {
	view: InboxView;
	channel: string;
	assigned: string;
	subject: string;
	/** 0 is the range control at its floor, which is not a filter. */
	waitingDays: number;
	/** Committed search text — the box has its own draft. */
	search: string;
	page: number;
};

const EMPTY: QueueFilters = {
	view: 'open',
	channel: '',
	assigned: '',
	subject: '',
	waitingDays: 0,
	search: '',
	page: 1
};

export const filters = $state<QueueFilters>({ ...EMPTY });

/** Is the filter panel showing? It replaces the conversation pane while it is. */
let panelOpen = $state(false);
export const filterPanel = {
	get open() {
		return panelOpen;
	},
	set open(value: boolean) {
		panelOpen = value;
	}
};

const parseView = (raw: string | null): InboxView =>
	inboxViews.includes(raw as InboxView) ? (raw as InboxView) : 'open';

/** Read the query string into the filters. Safe to call on every navigation. */
export function seedFromUrl(params: URLSearchParams): void {
	Object.assign(filters, {
		view: parseView(params.get('view')),
		channel: params.get('channel') ?? '',
		assigned: params.get('assigned') ?? '',
		subject: params.get('subject') ?? '',
		waitingDays: Number(params.get('waitingDays') ?? '0') || 0,
		search: params.get('q') ?? '',
		page: Number(params.get('page') ?? '1') || 1
	});
}

/**
 * The query string these filters describe.
 *
 * Pairs rather than a mutable `URLSearchParams` — the lint rule bans instances
 * of it — and defaults are left out entirely so a clean view has a clean URL.
 */
export function toSearch(f: QueueFilters = filters): string {
	const pairs: [string, string][] = [];
	if (f.view !== 'open') pairs.push(['view', f.view]);
	if (f.channel) pairs.push(['channel', f.channel]);
	if (f.assigned) pairs.push(['assigned', f.assigned]);
	if (f.subject) pairs.push(['subject', f.subject]);
	if (f.waitingDays) pairs.push(['waitingDays', String(f.waitingDays)]);
	if (f.search) pairs.push(['q', f.search]);
	if (f.page > 1) pairs.push(['page', String(f.page)]);
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** What both the list and the facet counts ask the server for. */
export function toQuery(f: QueueFilters = filters) {
	return {
		view: f.view,
		// Narrowed here rather than validated: the value only ever comes from the
		// channel <select>, whose options are this list, and the server's Zod
		// schema is the actual gate.
		channel: (f.channel || undefined) as InboxChannel | undefined,
		assigned: f.assigned || undefined,
		subject: f.subject || undefined,
		waitingDays: f.waitingDays || undefined,
		search: f.search || undefined,
		page: f.page
	};
}

/**
 * How many filters are narrowing the list.
 *
 * The view is not one of them: it always has a value, so counting it would
 * leave "Clear" permanently on offer.
 */
export function activeCount(f: QueueFilters = filters): number {
	return (
		(f.search ? 1 : 0) +
		(f.channel ? 1 : 0) +
		(f.assigned ? 1 : 0) +
		(f.subject ? 1 : 0) +
		(f.waitingDays ? 1 : 0)
	);
}

/** Clear everything but the view — the tab you are on is not a filter. */
export function reset(): void {
	const view = untrack(() => filters.view);
	Object.assign(filters, EMPTY, { view });
}

/** Apply a saved view's stored filters. Unknown keys are ignored by design. */
export function applySaved(saved: Record<string, unknown>): void {
	Object.assign(filters, EMPTY, {
		view: parseView(typeof saved.view === 'string' ? saved.view : null),
		channel: typeof saved.channel === 'string' ? saved.channel : '',
		assigned: typeof saved.assigned === 'string' ? saved.assigned : '',
		subject: typeof saved.subject === 'string' ? saved.subject : '',
		waitingDays: typeof saved.waitingDays === 'number' ? saved.waitingDays : 0,
		search: typeof saved.q === 'string' ? saved.q : ''
	});
}
