import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { sourceFiles } from './lib/source-files';

/**
 * A group of `StatCard`s sits in `StatGrid`, which folds two-up at phone
 * width. A hand-written grid drifts to `grid-cols-1` (#2693). Walking up from
 * each `StatCard`: `StatGrid` passes, an element with a `grid` class fails,
 * and a `flex` row ends the walk as a row that is not a grid.
 */
type Node = {
	type: string;
	name?: string;
	start: number;
	end: number;
	attributes?: { type: string; name?: string; start: number; end: number }[];
	[key: string]: unknown;
};

const CHILD_KEYS = [
	'fragment',
	'consequent',
	'alternate',
	'body',
	'fallback',
	'pending',
	'then',
	'catch'
];

function classOf(node: Node, source: string): string {
	const attr = node.attributes?.find((a) => a.type === 'Attribute' && a.name === 'class');
	return attr ? source.slice(attr.start, attr.end) : '';
}

function offenders(file: string): string[] {
	const source = readFileSync(file, 'utf8');
	const ast = parse(source, { modern: true }) as unknown as { fragment: { nodes: Node[] } };
	const found = new Set<string>();

	/** The hand-written grid holding this card, if any. */
	function wrongGrid(ancestors: Node[]): Node | undefined {
		for (let i = ancestors.length - 1; i >= 0; i--) {
			const node = ancestors[i];
			if (node.type === 'Component' && node.name === 'StatGrid') return undefined;
			if (node.type !== 'RegularElement') continue;
			const cls = classOf(node, source);
			if (/\bgrid\b/.test(cls)) return node;
			if (/\bflex\b/.test(cls)) return undefined;
		}
		return undefined;
	}

	function walk(nodes: Node[], ancestors: Node[]) {
		for (const node of nodes) {
			const grid = node.type === 'Component' && node.name === 'StatCard' && wrongGrid(ancestors);
			if (grid) found.add(`${file}:${source.slice(0, grid.start).split('\n').length}`);
			for (const key of CHILD_KEYS) {
				const child = node[key] as { nodes?: Node[] } | null | undefined;
				if (child?.nodes) walk(child.nodes, [...ancestors, node]);
			}
		}
	}

	walk(ast.fragment.nodes, []);
	return [...found];
}

describe('StatCard groups', () => {
	it('sit in StatGrid rather than a hand-written grid', () => {
		const all = sourceFiles(['src/**/*.svelte'], new Set()).flatMap(offenders);

		expect(all).toEqual([]);
	});
});
