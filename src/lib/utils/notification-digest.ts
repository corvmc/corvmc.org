/**
 * What a `notification_digest` row carries in `data`: a snapshot of the held
 * notices it summarises. `ids` is for the server, which reads the listed rows
 * when the summary is read; the bell shows `items` and `count`.
 */
export interface DigestItem {
	title: string;
	href: string | null;
}

export interface DigestData {
	ids: string[];
	items: DigestItem[];
	count: number;
}

/** The bell's view of a summary row's `data`. Null when it is not a summary's shape. */
export function parseDigest(data: unknown): Pick<DigestData, 'items' | 'count'> | null {
	if (!data || typeof data !== 'object') return null;
	const { items, count } = data as { items?: unknown; count?: unknown };
	if (!Array.isArray(items) || typeof count !== 'number') return null;
	const parsed = items.flatMap((i): DigestItem[] => {
		if (!i || typeof i !== 'object') return [];
		const { title, href } = i as { title?: unknown; href?: unknown };
		if (typeof title !== 'string') return [];
		return [{ title, href: typeof href === 'string' ? href : null }];
	});
	return { items: parsed, count };
}
