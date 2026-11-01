import { flattenNav, type NavNode } from './active-nav';

/**
 * Which sidebar rows a viewer has starred, per device, like `nav-collapse.ts`.
 * Plain functions for the same reason: module `$state` would be shared by
 * every concurrent SSR request. Keys the viewer can no longer see are kept in
 * storage, so a capability that comes back brings its star with it.
 */

const storageKey = (scope: string) => `cmc:nav-starred:${scope}`;

export function readStarred(scope: string): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(storageKey(scope));
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
	} catch {
		return [];
	}
}

/** Flips one key and returns the stored list, which is what the caller renders. */
export function toggleStarred(scope: string, key: string): string[] {
	const current = readStarred(scope);
	const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
	if (typeof localStorage === 'undefined') return next;
	try {
		localStorage.setItem(storageKey(scope), JSON.stringify(next));
	} catch {
		// Quota or private mode: the star holds for this page view only.
	}
	return next;
}

/**
 * The starred rows to render, in nav order. Pass the tree *after* capability
 * filtering: a key that names a hidden row, or no row at all, drops here.
 */
export function resolveStarred<N extends NavNode>(keys: readonly string[], items: N[]): N[] {
	if (keys.length === 0) return [];
	const wanted = new Set(keys);
	return (flattenNav(items) as N[]).filter((node) => wanted.has(node.key));
}
