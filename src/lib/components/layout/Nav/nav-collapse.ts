/**
 * Which sidebar groups a viewer has collapsed, remembered across reloads.
 *
 * Stores the *collapsed* set rather than the open set on purpose: an absent
 * entry means open, so a group added later shows up expanded for people who
 * already have a record, with no migration.
 *
 * Deliberately plain functions rather than module-level `$state` in a
 * `.svelte.ts` — that would be one store shared by every concurrent SSR
 * request. Seven reads on mount cost nothing.
 */

const storageKey = (scope: string) => `cmc:nav-collapsed:${scope}`;

function read(scope: string): Record<string, boolean> {
	// `NavGroup` renders on the server, and Safari's private mode throws on
	// access rather than returning null.
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(storageKey(scope));
		const parsed: unknown = raw ? JSON.parse(raw) : {};
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
	} catch {
		return {};
	}
}

export function readCollapsed(scope: string, key: string): boolean {
	return read(scope)[key] === true;
}

export function writeCollapsed(scope: string, key: string, collapsed: boolean): void {
	if (typeof localStorage === 'undefined') return;
	const next = read(scope);
	if (collapsed) next[key] = true;
	else delete next[key];
	try {
		localStorage.setItem(storageKey(scope), JSON.stringify(next));
	} catch {
		// Quota or private mode. Losing the preference is not worth an error.
	}
}
