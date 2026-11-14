import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A guard names a capability; holding some position is not one (#2985). An
 * `allowStaff` option or an `isElevated` admission let every position through,
 * so an auditor passed band, group and notification guards meant for staff.
 * This fails on either one in source, outside the uses listed below.
 */
// Server code only: `isElevated` and `requireGroupRole` cannot reach a component.
const SOURCE = ['src/**/*.ts'];

/** `file` → why it may ask whether someone holds any position at all. */
const ANY_POSITION: Record<string, string> = {
	'src/lib/remote/account.remote.ts':
		'refuses self-deletion to anyone with a job; an admin closes those accounts'
};

/** `allowStaff` as an option, and `isElevated(...)` calls, with their lines. */
export function anyPositionUses(file: string, text: string): string[] {
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const hits: string[] = [];
	const at = (n: ts.Node, what: string) =>
		hits.push(`${what} at line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
	const visit = (n: ts.Node) => {
		if (
			(ts.isPropertyAssignment(n) || ts.isPropertySignature(n)) &&
			ts.isIdentifier(n.name) &&
			n.name.text === 'allowStaff'
		)
			at(n, 'allowStaff');
		if (
			ts.isCallExpression(n) &&
			ts.isIdentifier(n.expression) &&
			n.expression.text === 'isElevated'
		)
			at(n, 'isElevated');
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return hits;
}

describe('guards name a capability, not any position', () => {
	const files = sourceFiles(SOURCE, new Set()).filter((f) => !/\.(spec|test)\.ts$/.test(f));

	it('detects both shapes', () => {
		const src = `requireGroupRole(ref, 'member', { allowStaff: true });
			type O = { allowStaff?: boolean };
			if (await isElevated(id)) {}`;
		expect(anyPositionUses('x.ts', src)).toEqual([
			'allowStaff at line 1',
			'allowStaff at line 2',
			'isElevated at line 3'
		]);
	});

	it('finds none outside the listed uses', () => {
		const offenders = files
			.filter((f) => !(f in ANY_POSITION))
			.flatMap((f) => anyPositionUses(f, readFileSync(f, 'utf8')).map((h) => `${f}: ${h}`));
		expect(offenders).toEqual([]);
	});

	it('lists only files that still use it', () => {
		const stale = Object.keys(ANY_POSITION).filter(
			(f) => anyPositionUses(f, readFileSync(f, 'utf8')).length === 0
		);
		expect(stale).toEqual([]);
	});
});
