import { describe, expect, it, vi } from 'vitest';

// See csp-config.spec.ts: the adapter pulls in sources this runner cannot parse.
vi.mock('@sveltejs/adapter-cloudflare', () => ({ default: () => ({ name: 'stub' }) }));

const { default: config } = await import('../kit.config.js');

// A component compiled outside runes mode wraps each import its template reads
// in `$.deep_read_state`. For `m` that is the whole message namespace, so every
// message lands in the route's bundle: 105 KB gzipped on /about (#3158). Such a
// file imports the messages it uses by name.
const sources = import.meta.glob<string>('./**/*.{svelte,md,svx}', {
	query: '?raw',
	import: 'default',
	eager: true
});

const runes = config.compilerOptions?.runes as (opts: { filename: string }) => boolean | undefined;
const legacy = Object.keys(sources).filter(
	(file) => !runes({ filename: `/repo/src/${file.slice(2)}` })
);

const importsM = (source: string) =>
	/import\s*\{[^}]*\bm\b[^}]*\}\s*from\s*['"][^'"]*paraglide\/messages(\.js)?['"]/.test(source);

describe('legacy-mode components and the message catalog', () => {
	it('finds the legacy-mode files', () => {
		expect(legacy).toContain('./lib/markdown/prose.svelte');
	});

	it.each(legacy)('%s does not import the `m` namespace', (file) => {
		expect(importsM(sources[file])).toBe(false);
	});
});
