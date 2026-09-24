import type { ResolvedPathname } from '$app/types';

/**
 * Append a query string to a `resolve()`d path. `path` is typed `string` on purpose:
 * a template literal over `resolve()` makes TypeScript expand the whole route union
 * into a template-literal type, which is already at its complexity limit (#1610).
 * The route part is checked by `resolve()`; only the join is asserted, here, once.
 */
export function withQuery(path: string, query: string | URLSearchParams): ResolvedPathname {
	const q = String(query).replace(/^\?/, '');
	return (q ? `${path}?${q}` : path) as ResolvedPathname;
}
