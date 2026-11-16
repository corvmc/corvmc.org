import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { generateSlug } from './slug';

describe('generateSlug', () => {
	it('drops spaces and punctuation and keeps typed hyphens', () => {
		expect(generateSlug('Porch Lights')).toBe('porchlights');
		expect(generateSlug('--Sun--Ra--')).toBe('sun-ra');
	});
});

// A form previewing an address has to apply the server's rule. Three components
// carried their own copy of it; this keeps the rule in one module.
describe('the slug rule', () => {
	const root = join(process.cwd(), 'src');
	const files = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
		);

	it('is written once, in $lib/utils/slug.ts', () => {
		const copies = files(root)
			.filter((f) => /\.(ts|svelte)$/.test(f) && !/\.(spec|test)\.ts$/.test(f))
			.filter((f) => readFileSync(f, 'utf8').includes(".replace(/[^a-z0-9-]+/g, '')"))
			.map((f) => relative(root, f));
		expect(copies).toEqual(['lib/utils/slug.ts']);
	});
});
