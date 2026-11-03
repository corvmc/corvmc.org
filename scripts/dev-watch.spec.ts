import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// vite.config.ts cannot be imported under vitest ("registerHooks" is not
// available), so the server block is read as text.
describe('dev server watch', () => {
	it('skips the local platform state under .wrangler/ (#1920)', () => {
		const source = readFileSync('vite.config.ts', 'utf8');
		const server = source.slice(source.indexOf('\tserver: {'), source.indexOf('\tpreview: {'));
		expect(server).toMatch(/\bwatch:\s*\{\s*ignored:\s*\[\s*'\*\*\/\.wrangler\/\*\*'\s*\]/);
	});
});
