import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';

/**
 * The class behind #2664: a form control spread from a `$derived` that reads
 * state set on mount. An input event handled while a query refresh is pending
 * re-runs the spread with the derived's cached pre-mount result. When that
 * result lacks `value`, Svelte sets the live input to empty, and the submit
 * posts an empty field the screen still shows as filled. Compute such a spread
 * where it is spread, keyed on a plain flag.
 */

const SRC = new URL('.', import.meta.url).pathname;
const CONTROLS = new Set(['input', 'textarea', 'select']);

function svelteFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...svelteFiles(full));
		else if (entry.name.endsWith('.svelte')) out.push(full);
	}
	return out;
}

/** Names assigned inside an `onMount(...)` callback. */
function setOnMount(script: string): Set<string> {
	const names = new Set<string>();
	for (const m of script.matchAll(/onMount\(/g)) {
		let depth = 0;
		let end = m.index + 'onMount('.length;
		for (; end < script.length; end++) {
			if (script[end] === '(') depth++;
			else if (script[end] === ')' && depth-- === 0) break;
		}
		const body = script.slice(m.index, end);
		for (const a of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names.add(a[1]);
	}
	return names;
}

/** `$derived` declarations, by name, with their source text. */
function deriveds(script: string): Map<string, string> {
	const out = new Map<string, string>();
	const re = /\b(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\$derived(?:\.by)?\(/g;
	for (const m of script.matchAll(re)) {
		let depth = 0;
		let end = m.index + m[0].length;
		for (; end < script.length; end++) {
			if (script[end] === '(') depth++;
			else if (script[end] === ')' && depth-- === 0) break;
		}
		out.set(m[1], script.slice(m.index + m[0].length, end));
	}
	return out;
}

/** Identifiers spread (`{...name}`) onto a form control. */
function spreadOntoControls(ast: unknown): string[] {
	const out: string[] = [];
	const walk = (node: unknown) => {
		if (!node || typeof node !== 'object') return;
		const n = node as { type?: string; name?: string; attributes?: unknown[] };
		if (n.type === 'RegularElement' && n.name && CONTROLS.has(n.name)) {
			for (const attr of n.attributes ?? []) {
				const a = attr as { type: string; expression?: { type: string; name?: string } };
				if (a.type === 'SpreadAttribute' && a.expression?.type === 'Identifier')
					out.push(a.expression.name!);
			}
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) value.forEach(walk);
			else if (value && typeof value === 'object') walk(value);
		}
	};
	walk(ast);
	return out;
}

function mountGatedSpreads(source: string): string[] {
	const script = source.match(/<script(?![^>]*module)[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
	const mounted = setOnMount(script);
	if (mounted.size === 0) return [];
	const derived = deriveds(script);
	const ast = parse(source, { modern: true });
	return spreadOntoControls(ast.fragment).filter((name) => {
		const body = derived.get(name);
		return body !== undefined && [...mounted].some((m) => new RegExp(`\\b${m}\\b`).test(body));
	});
}

describe('form control spreads', () => {
	it('flags a spread cached in a $derived that reads mount state', () => {
		const source = `<script>
	import { onMount } from 'svelte';
	let { attrs } = $props();
	let hydrated = $state(false);
	let spread = $derived(hydrated ? attrs : { name: attrs.name });
	onMount(() => { hydrated = true; });
</script>
<input {...spread} />`;
		expect(mountGatedSpreads(source)).toEqual(['spread']);
	});

	it('are not cached from mount state anywhere in src', () => {
		const offenders = svelteFiles(SRC).flatMap((file) =>
			mountGatedSpreads(readFileSync(file, 'utf8')).map((n) => `${relative(SRC, file)}: ${n}`)
		);
		expect(offenders).toEqual([]);
	});
});
