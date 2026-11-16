#!/usr/bin/env node
// Gzipped JavaScript each page route preloads before it can hydrate, read from
// a finished `vite build`. Fails when the entry every route shares, or any one
// route, grows past its budget. Run after the build: `node scripts/bundle-budget.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** Gzipped KB the app entry (`start`, `app` and their imports) may weigh. */
export const ENTRY_BUDGET_KB = 150;
/** Gzipped KB any one route's preloaded JavaScript, entry included, may weigh. */
export const ROUTE_BUDGET_KB = 520;
/**
 * Routes already over ROUTE_BUDGET_KB, each capped where it stood (#3158). The
 * staff lists load the rich-text editor; lower or delete a line as it is split out.
 * @type {Record<string, number>}
 */
export const KNOWN_HEAVY_KB = {
	'/staff/clubs': 600,
	'/staff/bands': 600,
	'/staff/committees': 600,
	'/staff/bands/[id]': 550
};

const output = path.resolve(process.argv[2] ?? '.svelte-kit/output');

/** @param {string} file */
function nodeImports(file) {
	const source = fs.readFileSync(file, 'utf8');
	const match = source.match(/export const imports = (\[[^\]]*\])/);
	return match ? /** @type {string[]} */ (JSON.parse(match[1])) : [];
}

/** @type {Map<string, number>} */
const sizes = new Map();
/** @param {string[]} files */
function gzipKb(files) {
	let bytes = 0;
	for (const file of new Set(files)) {
		let size = sizes.get(file);
		if (size === undefined) {
			size = gzipSync(fs.readFileSync(path.join(output, 'client', file))).length;
			sizes.set(file, size);
		}
		bytes += size;
	}
	return bytes / 1024;
}

const { manifest } = await import(path.join(output, 'server', 'manifest.js'));
/** @type {string[]} */
const entry = [manifest.client.start, manifest.client.app, ...manifest.client.imports];
const entryKb = gzipKb(entry);

/** @type {Map<number, string[]>} */
const nodes = new Map();
/** @param {number} index */
function importsOf(index) {
	let list = nodes.get(index);
	if (!list) {
		list = nodeImports(path.join(output, 'server', 'nodes', `${index}.js`));
		nodes.set(index, list);
	}
	return list;
}

/** @type {{ id: string; kb: number }[]} */
const routes = [];
for (const route of manifest.routes) {
	if (!route.page) continue;
	/** @type {number[]} */
	const indexes = [...route.page.layouts, route.page.leaf].filter((i) => i !== undefined);
	routes.push({ id: route.id, kb: gzipKb([...entry, ...indexes.flatMap(importsOf)]) });
}
routes.sort((a, b) => b.kb - a.kb);

const kb = (/** @type {number} */ n) => `${n.toFixed(1)} KB`;
console.log(`entry: ${kb(entryKb)} gzipped (budget ${ENTRY_BUDGET_KB} KB)`);
console.log(`${routes.length} page routes; heaviest:`);
for (const { id, kb: size } of routes.slice(0, 8)) console.log(`  ${kb(size).padStart(9)}  ${id}`);

const budgetOf = (/** @type {string} */ id) => KNOWN_HEAVY_KB[id] ?? ROUTE_BUDGET_KB;
const over = routes.filter((r) => r.kb > budgetOf(r.id));
let failed = false;
if (entryKb > ENTRY_BUDGET_KB) {
	console.error(`\nThe app entry is ${kb(entryKb)}, over its ${ENTRY_BUDGET_KB} KB budget.`);
	failed = true;
}
if (over.length) {
	console.error(`\n${over.length} route(s) over budget:`);
	for (const r of over) console.error(`  ${kb(r.kb)}  ${r.id} (budget ${budgetOf(r.id)} KB)`);
	failed = true;
}
if (failed) {
	console.error(
		'\nSomething heavy is now loaded before first paint. Import it dynamically where' +
			'\nit is used, or raise the budget in scripts/bundle-budget.mjs with the reason.'
	);
	process.exit(1);
}
