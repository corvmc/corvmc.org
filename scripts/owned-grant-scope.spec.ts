import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { grantRuleFor } from '../src/lib/config';
import { sourceFiles } from './lib/source-files';
import { CallGraph, walkEvents, type Key } from './lib/remote-calls';

/**
 * An `'owned'` committee grant reaches only records its committee owns, so a
 * guard holds it only when it passes the record's scope (#2984). A remote that
 * names a row by id and calls `requireCapability` for an `'owned'` capability
 * with no scope admits staff alone, whatever the committee was granted. This
 * walks each remote and the `src/lib/remote` helpers it reaches.
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];

/** Schema fields naming a row that a committee or a project can own. */
const ROW_KEYS = new Set([
	'id',
	'workOrderId',
	'taskId',
	'shiftId',
	'signupId',
	'scheduleId',
	'eventId',
	'projectId'
]);

/**
 * Remotes, by file or by `file#name`, that stay org-wide on purpose. Each says
 * why: the row has no owner, the remote creates one, or scope would widen a
 * grant past what its label says.
 */
const ORG_WIDE: Record<string, string> = {
	'src/lib/remote/venues.remote.ts': 'a venue belongs to no committee or project',
	'src/lib/remote/external-acts.remote.ts': 'an outside act belongs to no committee or project',
	'src/lib/remote/users.remote.ts': 'a member, not a record a committee owns',
	'src/lib/remote/event-photos.remote.ts': 'a photo set is staff curation',
	'src/lib/remote/duty-lists.remote.ts#updateDutyList': 'a template belongs to no committee',
	'src/lib/remote/duty-lists.remote.ts#deleteDutyList': 'a template belongs to no committee',
	'src/lib/remote/duty-lists.remote.ts#updateDutyListItem': 'a template belongs to no committee',
	'src/lib/remote/duty-lists.remote.ts#removeDutyListItem': 'a template belongs to no committee',
	'src/lib/remote/events.remote.ts#cancelEvent': 'cancelling a listing is not a vendor decision',
	'src/lib/remote/events.remote.ts#deleteEvent': 'deleting records stays with staff',
	'src/lib/remote/projects.remote.ts#attachToProjectForm': 'would pull any row into the project',
	'src/lib/remote/projects.remote.ts#detachFromProjectForm': 'would pull any row out of it',
	'src/lib/remote/tasks.remote.ts#createCatalogueTaskForm': 'a task in no project has no row yet',
	'src/lib/remote/work-requests.remote.ts#sendEquipmentReportToWorkOrder':
		'a new task has no row yet'
};

const isOwned = (cap: string) => grantRuleFor(cap)?.committee === 'owned';

/** `requireCapability('x.y')` with no scope argument: the literal, or null. */
export function unscopedOwned(node: ts.Node): string[] {
	const sf = node.getSourceFile();
	const hits: string[] = [];
	const visit = (n: ts.Node) => {
		if (
			ts.isCallExpression(n) &&
			ts.isIdentifier(n.expression) &&
			n.expression.text === 'requireCapability' &&
			n.arguments.length === 1 &&
			ts.isStringLiteralLike(n.arguments[0]) &&
			isOwned(n.arguments[0].text)
		) {
			const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
			hits.push(`${n.arguments[0].text} at line ${line}`);
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return hits;
}

/** Every property name in a schema, following same-file `const` names and spreads. */
export function schemaKeys(schema: ts.Expression): Set<string> {
	const sf = schema.getSourceFile();
	const decls = new Map<string, ts.Expression>();
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		for (const d of st.declarationList.declarations) {
			if (ts.isIdentifier(d.name) && d.initializer) decls.set(d.name.text, d.initializer);
		}
	}
	const keys = new Set<string>();
	const seen = new Set<string>();
	const visit = (n: ts.Node) => {
		if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
			if (ts.isIdentifier(n.name)) keys.add(n.name.text);
		}
		if (ts.isIdentifier(n) && decls.has(n.text) && !seen.has(n.text)) {
			seen.add(n.text);
			visit(decls.get(n.text)!);
		}
		ts.forEachChild(n, visit);
	};
	visit(schema);
	return keys;
}

/** The handler and every `src/lib/remote` function it reaches. */
function reachedHits(g: CallGraph, start: Key): string[] {
	const hits: string[] = [];
	const seen = new Set<Key>([start]);
	const stack: Key[] = [start];
	while (stack.length) {
		const key = stack.pop()!;
		const body = g.body(key);
		if (!body) continue;
		for (const h of unscopedOwned(body.node)) hits.push(`${key.split('#')[1]}: ${h}`);
		walkEvents(g, body.mod, body.node, (e) => {
			if (e.kind === 'call' && e.key.startsWith('src/lib/remote/') && !seen.has(e.key)) {
				seen.add(e.key);
				stack.push(e.key);
			}
			return undefined;
		});
	}
	return hits;
}

describe("guards on owned rows pass the row's scope", () => {
	const g = new CallGraph();
	const remotes = g.remotes(sourceFiles(REMOTE_GLOB, new Set()));

	it('finds the remotes', () => {
		expect(remotes.length).toBeGreaterThan(600);
	});

	it('detects an unscoped owned guard and follows a schema name', () => {
		const src = `const fields = { shiftId: z.string() };
			const s = z.object({ ...fields });
			async function f() {
				await requireCapability('volunteer.manageShifts');
				await requireCapability('volunteer.manageShifts', scope);
				await requireCapability('volunteer.read');
			}`;
		const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true);
		expect(unscopedOwned(sf)).toEqual(['volunteer.manageShifts at line 4']);
		const decl = (sf.statements[1] as ts.VariableStatement).declarationList.declarations[0];
		expect([...schemaKeys(decl.initializer!)]).toContain('shiftId');
	});

	// Walked at collection, not in the test: a whole-program walk under load outruns a test timeout (#2916).
	const offenders = remotes
		.filter((r) => !(r.file in ORG_WIDE) && !(`${r.file}#${r.name}` in ORG_WIDE))
		.filter((r) => r.schema && [...schemaKeys(r.schema)].some((k) => ROW_KEYS.has(k)))
		.flatMap((r) => reachedHits(g, r.key).map((h) => `${r.file}#${r.name} → ${h}`));

	it('pass a scope with every owned capability', () => {
		expect(offenders).toEqual([]);
	});

	it('lists only remotes that exist', () => {
		const names = new Set(remotes.flatMap((r) => [r.file, `${r.file}#${r.name}`]));
		expect(Object.keys(ORG_WIDE).filter((k) => !names.has(k))).toEqual([]);
	});
});
