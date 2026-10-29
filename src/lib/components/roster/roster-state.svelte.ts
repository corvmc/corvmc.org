import { urlState, text, positiveInt, type UrlField, type UrlFields } from '$lib/urlState.svelte';
import { toHref } from '$lib/utils/url-filters';

/** The two filters every roster has: its search box and its page. */
export interface RosterFilters {
	q: string;
	page: number;
}

export interface RosterState<S> {
	/** URL-backed: read in a `$derived`, assign from a handler, `bind:` from a control. */
	values: S & RosterFilters;
	/** Filters away from their default, search included and the page not. */
	readonly activeCount: number;
	clear(): void;
	/** The filters as a query string without `?` or `page`, for an export link. */
	readonly query: string;
}

/**
 * A roster's filter state. `q` and `page` are added; `fields` are the page's own.
 *
 *     const roster = rosterState(resolve('/staff/volunteer/people'), { role: text() });
 */
export function rosterState<S extends Record<string, unknown>>(
	path: string,
	fields: UrlFields<S>
): RosterState<S> {
	type All = S & RosterFilters;
	const filterFields = { q: text(), ...fields } as unknown as UrlFields<All>;
	const all = { ...filterFields, page: positiveInt(1) } as UrlFields<All>;
	const values = urlState<All>(path, all);
	const keys = Object.keys(filterFields) as (keyof All)[];

	return {
		values,
		get activeCount() {
			return keys.filter((k) => values[k] !== all[k].default).length;
		},
		clear() {
			const target = values as Record<string, unknown>;
			for (const [k, field] of Object.entries(all))
				target[k] = (field as UrlField<unknown>).default;
		},
		get query() {
			return toHref('', filterFields, values).replace(/^\?/, '');
		}
	};
}
