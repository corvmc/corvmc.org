declare const uniqueTagsBrand: unique symbol;

/**
 * Tags with no repeat, compared case-insensitively. A tag list is rendered with
 * `{#each tags as tag (tag)}`, which throws `each_key_duplicate` on a repeat, so
 * a component that keys by the tag takes this type and only `uniqueTags` makes it.
 */
export type UniqueTags = readonly string[] & { readonly [uniqueTagsBrand]: true };

/** Distinct tags across the lists in order, case-insensitively, skipping blanks. */
export function uniqueTags(...lists: Iterable<string | null | undefined>[]): UniqueTags {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const list of lists) {
		for (const tag of list) {
			const trimmed = tag?.trim();
			const key = trimmed?.toLowerCase();
			if (!trimmed || !key || seen.has(key)) continue;
			seen.add(key);
			out.push(trimmed);
		}
	}
	return out as unknown as UniqueTags;
}

/** An event's comma-separated `tags` column as distinct tags. */
export function parseTagList(raw: string | null | undefined): UniqueTags {
	return uniqueTags(raw ? raw.split(',') : []);
}

/** A run of distinct tags is still distinct, so a slice keeps the type. */
export function sliceTags(tags: UniqueTags, start?: number, end?: number): UniqueTags {
	return tags.slice(start, end) as unknown as UniqueTags;
}
