import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `<svelte:boundary>` catches nothing without a `failed` snippet or an
 * `onerror`: the error passes straight through and the route 500s. That is how
 * a rejected U-tec credential took down the Staff Settings page that exists to
 * fix it (#1331).
 */

const BOUNDARY = /<svelte:boundary\b([^>]*)>([\s\S]*?)<\/svelte:boundary>/g;

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((f) => f.endsWith('.svelte'))
		.map((f) => join(dir, f));
}

describe('svelte:boundary', () => {
	it('catches something', () => {
		const unguarded = svelteFiles('src').filter((file) => {
			const source = readFileSync(file, 'utf8');
			return [...source.matchAll(BOUNDARY)].some(
				([, attrs, body]) => !attrs.includes('onerror') && !body.includes('#snippet failed')
			);
		});

		expect(unguarded).toEqual([]);
	});
});
