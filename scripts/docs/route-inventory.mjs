/**
 * Deterministic route inventory for docs-drift detection.
 *
 * Enumerates every user-facing page route from `src/routes/**\/+page.svelte`,
 * normalizes it to a URL path, and classifies it by panel. API endpoints
 * (`+server.ts`, no `+page.svelte`) are naturally excluded.
 *
 * Usage:
 *   node scripts/docs/route-inventory.mjs            # print current inventory as JSON
 *   node scripts/docs/route-inventory.mjs --write    # (re)write the committed snapshot
 *
 * The snapshot at docs/manual/route-inventory.json is the baseline the drift
 * checker diffs against. Pure Node — no dependencies, runs with bare `node`.
 */
import { readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROUTES_DIR = 'src/routes';
export const SNAPSHOT_PATH = 'docs/manual/route-inventory.json';

/** @param {string} dir @returns {string[]} */
function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (entry === '+page.svelte') out.push(full);
	}
	return out;
}

/**
 * Turn a `src/routes/.../+page.svelte` path into a normalized URL route.
 *
 * @param {string} file
 */
export function fileToRoute(file) {
	let p = '/' + relative(ROUTES_DIR, file).replace(/\/?\+page\.svelte$/, '');
	// Drop SvelteKit route groups: (public), (app), etc.
	p = p
		.split('/')
		.filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))
		.join('/');
	// Normalize param matchers: [id=uuid] -> [id]
	p = p.replace(/\[([^\]=]+)=[^\]]+\]/g, '[$1]');
	return p === '' ? '/' : p;
}

/** @param {string} route */
export function panelOf(route) {
	if (route.startsWith('/member')) return 'member';
	if (route.startsWith('/staff')) return 'staff';
	if (route.startsWith('/band')) return 'band'; // covers /band and /band-site
	return 'public';
}

/** @typedef {{ route: string, panel: string }} RouteEntry */

/**
 * Returns a sorted array of { route, panel } for every page route.
 *
 * @returns {RouteEntry[]}
 */
export function listRoutes() {
	if (!existsSync(ROUTES_DIR)) return [];
	const routes = walk(ROUTES_DIR).map((file) => {
		const route = fileToRoute(file);
		return { route, panel: panelOf(route) };
	});
	// De-dupe (e.g. matcher collisions) and sort for stable diffs.
	/** @type {Map<string, RouteEntry>} */
	const seen = new Map();
	for (const r of routes) seen.set(r.route, r);
	return [...seen.values()].sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * The committed route inventory, or null when `pnpm docs:routes` has never run.
 *
 * @returns {RouteEntry[] | null}
 */
export function readSnapshot() {
	if (!existsSync(SNAPSHOT_PATH)) return null;
	return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
}

function main() {
	const routes = listRoutes();
	if (process.argv.includes('--write')) {
		writeFileSync(SNAPSHOT_PATH, JSON.stringify(routes, null, '\t') + '\n');
		console.log(`Wrote ${routes.length} routes to ${SNAPSHOT_PATH}`);
	} else {
		console.log(JSON.stringify(routes, null, '\t'));
	}
}

// Run main only when invoked directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) main();
