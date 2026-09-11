import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { sourceFiles } from './lib/source-files';

/**
 * A `<Story>` whose meta names a `component:` must not write that component
 * inside itself. addon-svelte-csf renders `<Component {...args}>` and hands the
 * story's markup down as that render's `children`, so what reaches the screen
 * is the component with every prop `undefined` — `$NaN` for SplitBar, an empty
 * wrapper swallowing a whole table for Table. Pass the props as `args`, or
 * write the component inside a `template` snippet, which is rendered as-is.
 */
type Node = {
	type?: string;
	name?: string;
	key?: { name?: string };
	value?: { type?: string; name?: string };
	expression?: { type?: string; name?: string; callee?: { type?: string; name?: string } };
	fragment?: { nodes?: unknown[] };
	body?: { nodes?: unknown[] };
};

function visit(node: unknown, seen: (node: Node) => void) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const item of node) visit(item, seen);
		return;
	}
	seen(node as Node);
	for (const value of Object.values(node)) visit(value, seen);
}

function metaComponent(module: unknown): string | undefined {
	let name: string | undefined;
	visit(module, (node) => {
		if (node.type !== 'Property' || node.key?.name !== 'component') return;
		if (node.value?.type === 'Identifier') name = node.value.name;
	});
	return name;
}

/** Stories in `file` that render the meta component inside their own children. */
function doubleRendered(file: string): string[] {
	const ast = parse(readFileSync(file, 'utf8'), { modern: true, filename: file });
	const component = metaComponent(ast.module);
	if (!component) return [];

	// `{@render x()}` inside a story is a hop into `x`'s body, so the snippets
	// have to be resolvable by name before the stories are walked.
	const snippets = new Map<string, unknown>();
	visit(ast.fragment, (node) => {
		if (node.type === 'SnippetBlock' && node.expression?.name) {
			snippets.set(node.expression.name, node.body);
		}
	});

	const offenders: string[] = [];
	visit(ast.fragment, (node) => {
		if (node.type !== 'Component' || node.name !== 'Story') return;
		if (writesComponent(node.fragment?.nodes ?? [], new Set())) {
			offenders.push(storyName(node) ?? '(unnamed)');
		}
	});
	return offenders;

	function writesComponent(node: unknown, expanded: Set<string>): boolean {
		if (!node || typeof node !== 'object') return false;
		if (Array.isArray(node)) return node.some((item) => writesComponent(item, expanded));

		const child = node as Node;
		// A `template` snippet is the documented escape: svelte-csf renders it
		// instead of the component, so what it writes is what is shown.
		if (child.type === 'SnippetBlock' && child.expression?.name === 'template') return false;
		if (child.type === 'Component' && child.name === component) return true;
		if (child.type === 'RenderTag') {
			const name = child.expression?.callee?.name ?? child.expression?.name;
			const body = name && !expanded.has(name) ? snippets.get(name) : undefined;
			if (body && name) return writesComponent(body, new Set([...expanded, name]));
		}
		return Object.values(node).some((value) => writesComponent(value, expanded));
	}

	function storyName(node: Node): string | undefined {
		const attributes = (node as { attributes?: { name?: string; value?: unknown }[] }).attributes;
		const name = attributes?.find((a) => a.name === 'name')?.value as
			[{ data?: string }] | undefined;
		return name?.[0]?.data;
	}
}

describe('story rendering', () => {
	it('never writes the component its own meta already renders', () => {
		const offenders = sourceFiles(['src/**/*.stories.svelte'], new Set())
			.flatMap((file) => doubleRendered(file).map((story) => `${file} → ${story}`))
			.sort();

		expect(
			offenders,
			`These stories write the component their meta already renders, so Storybook ` +
				`shows it once with empty args and swallows what was written as that ` +
				`render's children. Move the props into \`args\`, or write it in a ` +
				`\`template\` snippet:\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);
	});
});
