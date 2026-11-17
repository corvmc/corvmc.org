import { describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import { compile as mdsvex } from 'mdsvex';

// See csp-config.spec.ts: the adapter pulls in sources this runner cannot parse.
vi.mock('@sveltejs/adapter-cloudflare', () => ({ default: () => ({ name: 'stub' }) }));

const { default: config } = await import('../kit.config.js');

// A component compiled outside runes mode wraps each import its template reads
// in `$.deep_read_state`. For `m` that is the whole message namespace, so every
// message lands in the route's bundle: 105 KB gzipped on /about (#3158). Such a
// file reads `m` in its script instead.
const sources = import.meta.glob<string>('./**/*.{svelte,md,svx}', {
	query: '?raw',
	import: 'default',
	eager: true
});

const runes = config.compilerOptions?.runes as (opts: { filename: string }) => boolean | undefined;
const legacy = Object.keys(sources).filter(
	(file) => !runes({ filename: `/repo/src/${file.slice(2)}` })
);
const readsMessages = legacy.filter((file) => /paraglide\/messages/.test(sources[file]));

async function clientCode(file: string): Promise<string> {
	const source = /\.(md|svx)$/.test(file)
		? ((await mdsvex(sources[file]))?.code ?? '')
		: sources[file];
	return compile(source, { generate: 'client', filename: file, runes: false }).js.code;
}

describe('legacy-mode components and the message catalog', () => {
	it('finds the legacy-mode files that read messages', () => {
		expect(readsMessages).toContain('./lib/markdown/prose.svelte');
	});

	it.each(readsMessages)('%s does not deep-read the message namespace', async (file) => {
		expect(await clientCode(file)).not.toMatch(/deep_read_state\(\s*m\s*\)/);
	});
});
