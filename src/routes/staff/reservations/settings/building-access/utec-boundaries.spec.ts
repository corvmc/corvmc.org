import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * A query that waits on U-tec (seconds at p75) must not hold the page (#3144).
 * Each component that awaits one renders inside a `<svelte:boundary>` with its
 * own `pending` snippet, so the page paints from our own data first. A
 * boundary with no pending defers to the layout's, which holds everything.
 */
const UTEC_QUERIES = ['getLockHealth', 'getUnmanagedLockUsers', 'getUtecDevices'];

const ROOT = join(import.meta.dirname, '../../../../../..');

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		if (e.isDirectory()) return svelteFiles(path);
		return e.name.endsWith('.svelte') ? [path] : [];
	});
}

const files = svelteFiles(join(ROOT, 'src')).map((path) => ({
	path,
	source: readFileSync(path, 'utf8')
}));

const awaiting = files.filter(({ source }) =>
	UTEC_QUERIES.some((q) => new RegExp(`await\\s+${q}\\(`).test(source))
);

/** The `<svelte:boundary>` block around `at`, or null when there is none. */
function enclosingBoundary(source: string, at: number): string | null {
	const open = source.lastIndexOf('<svelte:boundary', at);
	if (open === -1) return null;
	const close = source.indexOf('</svelte:boundary>', at);
	if (close === -1 || source.lastIndexOf('</svelte:boundary>', at) > open) return null;
	return source.slice(open, close);
}

describe('U-tec queries', () => {
	it('finds the components that await one', () => {
		expect(awaiting.map((f) => basename(f.path)).toSorted()).toEqual([
			'LockHealth.svelte',
			'UnmanagedLockCodes.svelte',
			'UtecDevicePicker.svelte'
		]);
	});

	it.each(awaiting.map((f) => [basename(f.path, '.svelte')]))(
		'renders %s inside a boundary with its own pending',
		(name) => {
			const uses = files.flatMap(({ path, source }) =>
				[...source.matchAll(new RegExp(`<${name}[\\s/>]`, 'g'))].map((m) => ({
					path,
					boundary: enclosingBoundary(source, m.index)
				}))
			);
			expect(uses.length).toBeGreaterThan(0);
			for (const use of uses) {
				expect(use.boundary, use.path).toMatch(/\{#snippet pending\(/);
			}
		}
	);
});
