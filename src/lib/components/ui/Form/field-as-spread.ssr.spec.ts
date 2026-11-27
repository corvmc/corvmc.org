import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import { render } from 'svelte/server';
import Harness from './FieldSpread.test.svelte';

/**
 * Kit's `field.as()` defines `value`, `checked` and `files` as non-configurable
 * getters. On the server a component's spread props are merged with
 * `Object.defineProperty`, so `<C {...f.as('number')} value={x} />` throws
 * "Cannot redefine property: value" and the whole page is a 500 (#3302). The
 * browser merges through a Proxy and never notices. Pass `field={f}` instead.
 */
const HELD = new Set(['value', 'checked', 'files']);

const { create_field_proxy } = await import(
	/* @vite-ignore */ `${new URL('../../../../../node_modules/@sveltejs/kit/src/runtime/form-utils.js', import.meta.url).href}`
);

const kitField = (name: string) =>
	create_field_proxy(
		{
			form_id: 'spec',
			get: () => ({}),
			set: () => {},
			get_issues: () => ({}),
			get_touched: () => ({}),
			get_dirty: () => ({})
		},
		{},
		[name]
	);

const SRC = new URL('../../../../', import.meta.url).pathname;

function svelteFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...svelteFiles(full));
		else if (entry.name.endsWith('.svelte') && !entry.name.endsWith('.test.svelte')) out.push(full);
	}
	return out;
}

type Node = { type?: string; start?: number; [key: string]: unknown };

const isAsSpread = (attr: Node) => {
	const call = attr.expression as Node | undefined;
	if (attr.type !== 'SpreadAttribute' || call?.type !== 'CallExpression') return false;
	const callee = call.callee as Node;
	return callee.type === 'MemberExpression' && (callee.property as Node).name === 'as';
};

/** Components given a `.as()` spread and their own `value`/`checked`/`files`. */
function offenders(source: string): number[] {
	const found: number[] = [];
	const visit = (node: unknown): void => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(visit);
		const n = node as Node;
		if (n.type === 'Component' || n.type === 'SvelteComponent') {
			const attrs = n.attributes as Node[];
			const held = attrs.some(
				(a) => (a.type === 'Attribute' || a.type === 'BindDirective') && HELD.has(a.name as string)
			);
			if (held && attrs.some(isAsSpread)) found.push(n.start ?? 0);
		}
		for (const [key, value] of Object.entries(n)) if (key !== 'parent') visit(value);
	};
	visit(parse(source, { modern: true }).fragment);
	return found;
}

describe('a remote field spread into a component', () => {
	it('fails server rendering when the component also takes a value', async () => {
		const rendering = async () =>
			(await render(Harness, { props: { field: kitField('share'), shape: 'spread' } })).body;
		await expect(rendering()).rejects.toThrow(/Cannot redefine property: value/);
	});

	it('renders when the field is passed whole', async () => {
		const { body } = await render(Harness, { props: { field: kitField('share'), shape: 'field' } });
		expect(body).toMatch(/<input[^>]*name="n:share/);
	});

	it('is never combined with value, checked or files', () => {
		const found = svelteFiles(SRC).flatMap((file) => {
			const source = readFileSync(file, 'utf8');
			return offenders(source).map((at) => {
				const line = source.slice(0, at).split('\n').length;
				return `${relative(SRC, file)}:${line}`;
			});
		});
		expect(found).toEqual([]);
	});
});
