import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { sourceFiles } from './lib/source-files';

/**
 * Reading a `$state` or `$derived` into a plain `const` at a component's top
 * level takes its first value only. The band edit page kept the old band name
 * in its header after a rename (#2899). Svelte warns on this as
 * `state_referenced_locally`; this makes the warning fail the build. A read
 * that is meant to seed a form once says so with
 * `// svelte-ignore state_referenced_locally` on the line above.
 */
const GLOBS = ['src/**/*.svelte'];

function readsOnce(file: string): number[] {
	const { warnings } = compile(readFileSync(file, 'utf8'), {
		filename: file,
		generate: false,
		experimental: { async: true }
	});
	return warnings
		.filter((w) => w.code === 'state_referenced_locally')
		.map((w) => w.start?.line ?? 0);
}

describe('component scripts', () => {
	it('read state reactively, or mark a one-time read with svelte-ignore', () => {
		const offenders = sourceFiles(GLOBS, new Set()).flatMap((file) =>
			readsOnce(file).map((line) => `${file}:${line}`)
		);

		expect(offenders).toEqual([]);
		// Compiles every component: 1.6s on a laptop, 7s on a loaded CI runner.
	}, 60_000);
});
