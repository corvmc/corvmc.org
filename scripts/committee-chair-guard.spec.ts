import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A committee's chair is whoever holds its chair position (#3009); the stored
 * `group_member.role` on a committee row is always `member`. A leader test on
 * the stored role (`eq(groupMember.role, 'admin')`, `role in ('owner',
 * 'admin')`) silently drops every committee chair, so it goes through
 * `src/lib/server/group/chair.ts` (`isCommitteeChair`, `leadsGroup`,
 * `rosterRole`). This fails on one anywhere else.
 */
const SOURCE = ['src/**/*.ts', 'scripts/**/*.ts'];

/** `file` → why it may test the stored role for `admin`. */
const ALLOWED: Record<string, string> = {
	'src/lib/server/group/chair.ts': 'the one place the stored role is read as leadership'
};

/** Stored-role leader tests in one file, with their lines. */
export function storedAdminReads(file: string, text: string): string[] {
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const hits: string[] = [];
	const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
	const visit = (n: ts.Node) => {
		if (
			ts.isPropertyAccessExpression(n) &&
			n.name.text === 'role' &&
			ts.isIdentifier(n.expression) &&
			n.expression.text === 'groupMember'
		) {
			let up: ts.Node = n.parent;
			while (
				up &&
				!ts.isCallExpression(up) &&
				!ts.isTaggedTemplateExpression(up) &&
				!ts.isBinaryExpression(up) &&
				!ts.isStatement(up)
			)
				up = up.parent;
			if (up && !ts.isStatement(up) && /'admin'/.test(up.getText(sf))) {
				hits.push(`groupMember.role at line ${line(n)}`);
			}
		}
		if (
			(ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateLiteral(n)) &&
			/\brole\s*(=\s*'admin'|in\s*\([^)]*'admin')/i.test(n.getText(sf))
		) {
			hits.push(`SQL role test at line ${line(n)}`);
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return hits;
}

describe('committee chair checks read the chair position', () => {
	const files = sourceFiles(SOURCE, new Set()).filter((f) => !/\.(spec|test)\.ts$/.test(f));

	it('detects each shape', () => {
		const src = [
			`where(eq(groupMember.role, 'admin'))`,
			`where(inArray(groupMember.role, ['owner', 'admin']))`,
			"sql`case ${groupMember.role} when 'admin' then 1 end`",
			`const q = "select 1 from group_member where role in ('owner', 'admin')"`,
			`select({ role: groupMember.role })`,
			`where(eq(groupMember.role, 'owner'))`
		].join('\n');
		expect(storedAdminReads('x.ts', src)).toEqual([
			'groupMember.role at line 1',
			'groupMember.role at line 2',
			'groupMember.role at line 3',
			'SQL role test at line 4'
		]);
	});

	it('finds none outside chair.ts', () => {
		const offenders = files
			.filter((f) => !(f in ALLOWED))
			.flatMap((f) => storedAdminReads(f, readFileSync(f, 'utf8')).map((h) => `${f}: ${h}`));
		expect(offenders).toEqual([]);
	});
});
