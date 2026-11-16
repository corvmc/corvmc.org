import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import ts from 'typescript';

/**
 * The `?q=`/`?genre=` mirror must be created at component init, not in the
 * continuation of the page's top-level `await`. Effects created there are the
 * shape Svelte has stranded before (see `.claude/rules/svelte-ui.md`), and a
 * stranded mirror leaves the URL clean for the life of the page (#2224).
 */
const PAGE = new URL('./+page.svelte', import.meta.url).pathname;

function isDollarCall(node: ts.Node, name: string): node is ts.CallExpression {
	return (
		ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression) &&
		ts.isIdentifier(node.expression.expression) &&
		node.expression.expression.text === '$' &&
		node.expression.name.text === name
	);
}

describe('directory URL mirror', () => {
	it('is not gated behind the top-level await', () => {
		const { js } = compile(readFileSync(PAGE, 'utf8'), {
			generate: 'client',
			experimental: { async: true },
			filename: PAGE
		});
		const source = ts.createSourceFile('page.js', js.code, ts.ScriptTarget.Latest, true);

		let runs = 0;
		let effects = 0;
		let gated = 0;
		const visit = (node: ts.Node, insideRun: boolean) => {
			if (isDollarCall(node, 'run')) runs++;
			if (isDollarCall(node, 'user_effect')) {
				effects++;
				if (insideRun) gated++;
			}
			const nextInside = insideRun || isDollarCall(node, 'run');
			ts.forEachChild(node, (child) => visit(child, nextInside));
		};
		visit(source, false);

		// Canaries: without an await there is no gate, and without an effect
		// there is no mirror, so either would make the assertion vacuous.
		expect(runs).toBeGreaterThan(0);
		expect(effects).toBeGreaterThan(0);
		expect(gated).toBe(0);
	});
});
