import { describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { pastCachedKey, permanentRedirectSources } from '#lib/utils/permanent-redirects.js';

// Calls every route that can answer a 308, bare and once per query key any of
// them reads, and checks what the browser would cache (#2961).
const sources = import.meta.glob<string>('./**/+{page,server}.ts', {
	query: '?raw',
	import: 'default',
	eager: true
});
const helpers = import.meta.glob<string>('./**/*{views,redirect}*.ts', {
	query: '?raw',
	import: 'default',
	eager: true
});
const modules = import.meta.glob<Record<string, unknown>>('./**/+{page,server}.ts');

const routeId = (file: string) => file.slice(1).replace(/\/\+[a-z]+\.ts$/, '') || '/';
const permanent = Object.keys(sources).filter((f) => /redirect\(\s*308\b/.test(sources[f]));

const keys = [
	...new Set(
		[...permanent.map((f) => sources[f]), ...Object.values(helpers)].flatMap((src) =>
			[...src.matchAll(/\.(?:get|has)\('([\w-]+)'\)/g)].map((m) => m[1])
		)
	)
];

type Hop = { from: string; to: string };

async function probe(file: string, search: string): Promise<string | null> {
	const id = routeId(file);
	const params: Record<string, string> = {};
	for (const [, name] of id.matchAll(/\[(?:\.\.\.)?(\w+)\]/g)) params[name] = 'x';
	const path = id.replace(/\[(?:\.\.\.)?\w+\]/g, 'x');
	const url = new URL(`http://x${path}${search}`);
	const mod = await modules[file]();
	const handler = (mod.load ?? mod.GET) as (event: unknown) => unknown;
	try {
		await handler({ url, params, route: { id }, request: new Request(url), locals: {} });
	} catch (thrown) {
		if (isRedirect(thrown) && thrown.status === 308) return thrown.location;
		throw thrown;
	}
	return null;
}

const matcher = (id: string) =>
	new RegExp(`^${id.replace(/\[\.\.\.\w+\]/g, '.+').replace(/\[\w+\]/g, '[^/]+')}$`);

describe('permanent redirects', async () => {
	const bare = new Set<string>();
	const hops: Hop[] = [];
	for (const file of permanent) {
		for (const search of ['', ...keys.map((k) => `?${k}=x`)]) {
			const to = await probe(file, search);
			if (to === null) continue;
			if (search === '') bare.add(routeId(file));
			hops.push({ from: `${routeId(file)}${search}`, to });
		}
	}
	const former = permanentRedirectSources.filter((id) => !bare.has(id)).map(matcher);

	it('lists every bare 308 source in the ledger', () => {
		expect([...bare].filter((id) => !permanentRedirectSources.includes(id))).toEqual([]);
	});

	it('changes the URL of every redirect into a former source', () => {
		const loops = hops
			.map(({ from, to }) => ({ from: from.split('?')[0], to: new URL(to, 'http://x') }))
			.filter(
				({ to }) => former.some((m) => m.test(to.pathname)) && !to.searchParams.has(pastCachedKey)
			)
			.map(({ from, to }) => `${from} -> ${to.pathname}`);
		expect([...new Set(loops)]).toEqual([]);
	});
});
