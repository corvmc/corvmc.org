import { describe, expect, it } from 'vitest';
import { parse } from 'svelte/compiler';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `Action` types its overflow as `[key: string]: unknown` so a caller can pass
 * real HTML through to the trigger. That also makes a misspelt or invented prop
 * legal: it lands on the `<button>` as a lowercased attribute, which emits no
 * error, no type failure and no behaviour. `canSubmit` survived thirteen call
 * sites that way. Nothing else in the toolchain sees it, so this does.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const src = path.join(root, 'src');
const actionsDir = path.join(src, 'lib/components/actions');

/** Genuine passthrough: what a caller may legitimately put on the trigger. */
const HTML_PASSTHROUGH = /^(data-|aria-)|^(id|role|style|tabindex|title|type|name|form)$/;

function svelteFiles(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) svelteFiles(p, out);
		else if (entry.name.endsWith('.svelte')) out.push(p);
	}
	return out;
}

/** The names in `let { … } = $props()`, which is the whole of a component's API. */
function declaredProps(file: string): Set<string> {
	const ast = parse(fs.readFileSync(file, 'utf8'), { modern: true, filename: file });
	for (const stmt of ast.instance?.content?.body ?? []) {
		if (stmt.type !== 'VariableDeclaration') continue;
		for (const decl of stmt.declarations) {
			const init = decl.init as { type?: string; callee?: { name?: string } } | null;
			if (init?.type !== 'CallExpression' || init.callee?.name !== '$props') continue;
			if (decl.id.type !== 'ObjectPattern') continue;
			const names = new Set<string>();
			for (const prop of decl.id.properties) {
				if (prop.type === 'RestElement') continue;
				const key = prop.key as { name?: string; value?: string };
				names.add(key.name ?? String(key.value));
			}
			return names;
		}
	}
	throw new Error(`No $props() destructure found in ${file}`);
}

type Usage = { component: string; file: string; line: number; attr: string };

/** Every attribute passed to any of `components`, across `files`, in one parse pass. */
function usagesOf(components: Set<string>, files: string[]): Usage[] {
	const found: Usage[] = [];
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		const ast = parse(source, { modern: true, filename: file });
		const visit = (node: unknown): void => {
			if (!node || typeof node !== 'object') return;
			if (Array.isArray(node)) return node.forEach(visit);
			const n = node as Record<string, unknown> & { type?: string; name?: string };
			if (n.type === 'Component' && n.name && components.has(n.name)) {
				for (const attr of (n.attributes ?? []) as {
					type: string;
					name: string;
					start: number;
				}[]) {
					if (attr.type !== 'Attribute') continue;
					found.push({
						component: n.name,
						file: path.relative(root, file),
						line: source.slice(0, attr.start).split('\n').length,
						attr: attr.name
					});
				}
			}
			for (const key of Object.keys(n)) if (key !== 'parent') visit(n[key]);
		};
		visit(ast.fragment);
	}
	return found;
}

const actionProps = declaredProps(path.join(src, 'lib/components/ui/Action.svelte'));

describe('Action call sites', () => {
	it('pass no prop Action does not declare', () => {
		const stray = usagesOf(new Set(['Action']), svelteFiles(src)).filter(
			(u) => !actionProps.has(u.attr) && !HTML_PASSTHROUGH.test(u.attr)
		);

		expect(stray.map((u) => `${u.file}:${u.line} ${u.attr}`)).toEqual([]);
	});

	// The gate the thirteen call sites were asking for, named here so removing
	// the prop breaks this rather than quietly reverting them to ungated.
	it('can gate the submit through canSubmit', () => {
		expect(actionProps).toContain('canSubmit');
	});
});

/**
 * Each `actions/*` wrapper spreads its own `...rest` into `<Action>`, so the
 * chain from a call site to the DOM is one hop: what it may legitimately pass
 * is the wrapper's declared props ∪ `Action`'s. No fixpoint over the component
 * graph is needed, and anything outside that union reaches the trigger
 * `<button>` as a dead lowercased attribute.
 */
describe('actions/* call sites', () => {
	it('pass no prop the wrapper and Action both fail to declare', () => {
		const accepted = new Map<string, Set<string>>();
		for (const file of svelteFiles(actionsDir)) {
			const name = path.basename(file, '.svelte');
			accepted.set(name, new Set([...declaredProps(file), ...actionProps]));
		}

		const stray = usagesOf(new Set(accepted.keys()), svelteFiles(src)).filter(
			(u) => !accepted.get(u.component)!.has(u.attr) && !HTML_PASSTHROUGH.test(u.attr)
		);

		expect(stray.map((u) => `${u.file}:${u.line} <${u.component} ${u.attr}>`)).toEqual([]);
	});
});
