import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Kit filters `PUBLIC_*` out of `$env/dynamic/private`, so such a read is always
 * undefined, and a `??` fallback hides that in production.
 */
describe('$env/dynamic/private', () => {
	it('is never read for a PUBLIC_ variable', () => {
		const offenders = sourceFiles(['src/**/*.{ts,svelte}'], new Set())
			.filter((file) => !file.endsWith('.spec.ts'))
			.filter((file) => {
				const source = readFileSync(file, 'utf8');
				const binding = source.match(
					/import\s*\{\s*env(?:\s+as\s+(\w+))?\s*\}\s*from\s*'\$env\/dynamic\/private'/
				);
				return binding && new RegExp(`\\b${binding[1] ?? 'env'}\\.PUBLIC_`).test(source);
			});

		expect(offenders).toEqual([]);
	});
});
