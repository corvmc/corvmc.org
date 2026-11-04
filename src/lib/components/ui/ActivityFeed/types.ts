import type { ResolvedPathname } from '$app/types';
import type { FeedItem } from '#lib/types/activity.js';

export type { FeedItem, FeedPage } from '#lib/types/activity.js';

/** One rendered row: "summary" over "actor · time · context". */
export interface ActivityRow {
	id: string;
	at: Date;
	/** Omitted for the system. */
	actor?: { name: string; href?: ResolvedPathname | null } | null;
	summary: string;
	/** Links the summary to the record the row is about. */
	href?: ResolvedPathname | null;
	/** A trailing reference in the meta line, such as the task an entry is about. */
	context?: { label: string; href?: ResolvedPathname | null } | null;
}

/** The default mapping: a feed item's actor by name, unlinked. */
export function feedItemRow(item: FeedItem): ActivityRow {
	return {
		id: item.id,
		at: item.at,
		actor: item.actorName ? { name: item.actorName } : null,
		summary: item.summary
	};
}
