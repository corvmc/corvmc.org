import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sourceFiles } from '../lib/source-files';

/**
 * A full migration replay takes seconds and grows with every migration, so inside
 * a test it meets the 5s timeout on a loaded machine (#3000, #2749). A spec may
 * replay only at module scope, in `describe` or in `beforeAll`; `migratedTemplate`
 * then hands each test a copy.
 */
const REPLAYS = new Set(['applyMigrations', 'migratedTemplate']);
const SCOPES = new Set(['beforeAll', 'describe']);

/** Re-applies to a file already migrated, which replays nothing. */
const ALLOWED = new Set(['scripts/db/migrate-local.spec.ts']);

function calleeName(call: ts.CallExpression): string | undefined {
	const e = call.expression;
	if (ts.isIdentifier(e)) return e.text;
	if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text;
}

/** Lines where a replay runs inside a test or a helper function. */
function replaysInTests(source: string): number[] {
	const file = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true);
	const lines: number[] = [];
	const visit = (n: ts.Node) => {
		if (ts.isCallExpression(n) && REPLAYS.has(calleeName(n) ?? '')) {
			let fn: ts.Node | undefined = n.parent;
			while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
			const scope = fn?.parent && ts.isCallExpression(fn.parent) && calleeName(fn.parent);
			if (fn && !SCOPES.has(scope || '')) {
				lines.push(file.getLineAndCharacterOfPosition(n.getStart()).line + 1);
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(file);
	return lines;
}

describe('migration replays', () => {
	const found = sourceFiles(
		['scripts/**/*.spec.ts', 'src/**/*.spec.ts', 'e2e/**/*.e2e.ts'],
		ALLOWED
	)
		.filter((f) => f !== 'scripts/db/migration-replay-scope.spec.ts')
		.flatMap((f) => replaysInTests(readFileSync(f, 'utf8')).map((line) => `${f}:${line}`));

	it('run outside every test', () => {
		expect(found).toEqual([]);
	});

	it('are found in a test and in a helper, and allowed in beforeAll', () => {
		const source = `
			const fresh = migratedTemplate();
			function migrated() { applyMigrations(f); }
			describe('x', () => {
				beforeAll(() => applyMigrations(f));
				it('y', () => { applyMigrations(f); });
			});`;
		expect(replaysInTests(source)).toEqual([3, 6]);
	});
});
