/**
 * The pure half of URL-backed filter state: how a query value is read, and how
 * a set of values becomes an href.
 *
 * Kept free of `$app` and of runes so the policy can be unit-tested as a plain
 * table, the way `entity-href` and `canonical-address` are. The reactive half
 * — seeding state at mount and mirroring it back into the address bar — is
 * `$lib/urlState.svelte.ts`.
 */

/** How one query parameter is read and written. */
export interface UrlField<T> {
	/**
	 * The value that keeps this key OUT of the URL entirely. A view showing its
	 * defaults should have a clean address, so a member can tell at a glance
	 * whether a filter is on.
	 */
	default: T;
	/** Read a raw query value. Anything unrecognised must fall back, never throw. */
	parse: (raw: string | null) => T;
	encode: (value: T) => string;
}

/** Free text — a search box, an id, a `YYYY-MM-DD` typed into a date input. */
export function text<T extends string = string>(fallback = '' as T): UrlField<T> {
	return {
		default: fallback,
		parse: (raw) => (raw ?? fallback) as T,
		encode: (value) => value
	};
}

/**
 * One of a fixed set. Anything else is treated as absent rather than trusted,
 * because the query string is user input: `?status=' OR 1=1` reaching a filter
 * should select the default view, not a value no branch handles.
 */
export function oneOf<T extends string>(allowed: readonly T[], fallback: T): UrlField<T> {
	return {
		default: fallback,
		parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : fallback),
		encode: (value) => value
	};
}

/**
 * A 1-based counter — page numbers, and nothing else so far.
 *
 * Zero and negatives fall back rather than passing through. The hand-written
 * version of this was `Number(raw ?? '1') || 1`, which caught `0` by accident
 * (it is falsy) and let `-3` straight through to the query's `offset`.
 */
export function positiveInt(fallback: number): UrlField<number> {
	return {
		default: fallback,
		parse: (raw) => {
			const n = Number(raw);
			return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : fallback;
		},
		encode: (value) => String(value)
	};
}

/** Field definitions keyed the same way as the state they produce. */
export type UrlFields<S> = { [K in keyof S]: UrlField<S[K]> };

/** Seed every field from a query string. */
export function parseFields<S extends Record<string, unknown>>(
	fields: UrlFields<S>,
	params: URLSearchParams
): S {
	const out = {} as S;
	for (const key of Object.keys(fields) as (keyof S)[]) {
		out[key] = fields[key].parse(params.get(key as string));
	}
	return out;
}

/**
 * The href these values should be mirrored to.
 *
 * Built from pairs rather than a `URLSearchParams` instance: the repo's lint
 * rule bans mutable instances of it, and defaults are left out so a clean view
 * has a clean URL. Key order follows the field declaration order, which makes
 * the address stable rather than dependent on which filter was touched last.
 */
export function toHref<S extends Record<string, unknown>>(
	path: string,
	fields: UrlFields<S>,
	values: S
): string {
	const pairs: string[] = [];
	for (const key of Object.keys(fields) as (keyof S)[]) {
		const field = fields[key];
		const value = values[key];
		if (value === field.default) continue;
		pairs.push(`${String(key)}=${encodeURIComponent(field.encode(value))}`);
	}
	return pairs.length ? `${path}?${pairs.join('&')}` : path;
}
