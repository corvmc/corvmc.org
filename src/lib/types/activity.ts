/**
 * One row of a staff history feed, whatever it was read from: an audit entry,
 * a duty tick, a stock movement. Each source maps its own rows to this shape on
 * the server, and a page merges several sources by `at` before rendering them.
 */
export interface FeedItem {
	/** Unique across every source in the feed: prefix it with the source. */
	id: string;
	at: Date;
	/** Null for the system, or a member whose account is gone and left no name. */
	actorId: string | null;
	actorName: string | null;
	summary: string;
}

/** Newest first. `hasMore` is exact: each source is read with `limit + 1`. */
export interface FeedPage<T extends FeedItem = FeedItem> {
	items: T[];
	hasMore: boolean;
}

export const FEED_PAGE = 25;
export const FEED_MAX = 200;

/** Clamp a client-supplied page length to what a feed read accepts. */
export function feedLimit(limit: number | undefined): number {
	return Math.min(Math.max(Math.trunc(limit ?? FEED_PAGE), 1), FEED_MAX);
}

/**
 * Newest first. A same-second tie keeps the order the sources gave (the sort is
 * stable), so each source's own tie-break survives; an id is random and has none.
 */
export function newestFirst(a: FeedItem, b: FeedItem): number {
	return b.at.getTime() - a.at.getTime();
}

/** Merge already-limited sources into one page of `limit`. */
export function mergeFeed<T extends FeedItem>(limit: number, ...pages: FeedPage<T>[]): FeedPage<T> {
	const merged = pages.flatMap((p) => p.items).sort(newestFirst);
	return {
		items: merged.slice(0, limit),
		hasMore: merged.length > limit || pages.some((p) => p.hasMore)
	};
}
