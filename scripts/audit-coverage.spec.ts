import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { sourceFiles } from './lib/source-files';
import { CallGraph, walkEvents, type Key, type Remote } from './lib/remote-calls';

/**
 * Workflow gates warn, record and allow; the record is the audit log. A staff
 * change to money, a clearance, a setting, a visibility or a deletion declares
 * its row by wrapping its handler (`src/lib/server/audit/declared.ts`), and
 * this checks each declaration against what the handler reaches (#2841).
 * `custom/audit-declared` is the same rule for a handler that asks its
 * capability directly; this also follows guards that ask one for it.
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];
const AUDIT: Key = 'src/lib/server/audit/audit-service.ts#recordAuditEntry';
const CAPABILITY: Key = 'src/lib/server/authorization.ts#requireCapability';
const CAN: Key = 'src/lib/server/authorization.ts#can';
/**
 * A membership guard: it asks `can` only for a non-member, and only for the
 * capability its caller names, so it does not make a member's write a staff one.
 */
const MEMBERSHIP: Key = 'src/lib/server/group/group-context.ts#requireGroupRole';
const DECLARED = 'src/lib/server/audit/declared.ts';

type AuditClass = {
	name: string;
	applies: (r: Remote, caps: Set<string>, text: string) => boolean;
	/** The action a reached row must carry; any action answers when absent. */
	answers?: RegExp;
};

const CLASSES: AuditClass[] = [
	{
		name: 'money',
		// `complete…` is a status move, not a comp (#2891).
		applies: (r, caps) =>
			[
				'finance.refund',
				'finance.collect',
				'reservation.comp',
				'credit.adjust',
				'credit.comp'
			].some((c) => caps.has(c)) || /^(comp(?!lete)|refund)/.test(r.name)
	},
	{
		name: 'clearance',
		applies: (r, caps) =>
			caps.has('volunteer.manageCertifications') || /Orientation|Certification/.test(r.name)
	},
	{ name: 'settings', applies: (_r, caps) => caps.has('settings.update') },
	{
		name: 'visibility',
		applies: (_r, _caps, text) => /\bvisibility\b/i.test(text),
		answers: /\.visibility_changed$/
	},
	{ name: 'deletion', applies: (r) => /^(delete|remove|purge|merge)/.test(r.name) }
];

type Declaration =
	{ kind: 'audited' | 'writesAudit'; actions: string[] } | { kind: 'unaudited'; reason: string };

function literals(n: ts.Node | undefined): string[] {
	if (!n) return [];
	if (ts.isStringLiteralLike(n)) return [n.text];
	const out: string[] = [];
	ts.forEachChild(n, (c) => void out.push(...literals(c)));
	return out;
}

/** The wrapper a remote's handler is declared with, or null when it is a bare function. */
function declarationOf(g: CallGraph, r: Remote): Declaration | null {
	const call = r.handler;
	if (!ts.isCallExpression(call)) return null;
	const key = g.callee(g.mod(r.file)!, call.expression);
	if (!key?.startsWith(`${DECLARED}#`)) return null;
	const kind = key.slice(DECLARED.length + 1);
	const [first] = call.arguments;
	if (kind === 'unaudited') return { kind, reason: literals(first).join('') };
	if (kind === 'writesAudit') return { kind, actions: literals(first) };
	if (kind === 'audited' && first && ts.isObjectLiteralExpression(first)) {
		const action = first.properties.find(
			(p): p is ts.PropertyAssignment =>
				ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'action'
		);
		return { kind, actions: literals(action?.initializer) };
	}
	return null;
}

/** The `action` literals a `recordAuditEntry({ action })` call can write; `*` when not literal. */
function actionsOf(call: ts.Node): string[] {
	if (!ts.isCallExpression(call) && !ts.isIdentifier(call)) return ['*'];
	const arg = ts.isCallExpression(call) ? call.arguments[0] : undefined;
	if (!arg || !ts.isObjectLiteralExpression(arg)) return ['*'];
	const prop = arg.properties.find(
		(p): p is ts.PropertyAssignment =>
			ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'action'
	);
	if (!prop) return ['*'];
	const found: string[] = [];
	const collect = (n: ts.Node): void => {
		if (ts.isStringLiteralLike(n)) found.push(n.text);
		else ts.forEachChild(n, collect);
	};
	collect(prop.initializer);
	return found.length ? found : ['*'];
}

/** Every audit action a function can reach, through the calls the graph resolves. */
function reachedActions(g: CallGraph) {
	const memo = new Map<Key, Set<string>>();
	const reach = (key: Key): Set<string> => {
		if (memo.has(key)) return memo.get(key)!;
		const out = new Set<string>();
		// A cycle answers what it has found so far.
		memo.set(key, out);
		const body = g.body(key);
		if (body) {
			walkEvents(g, body.mod, body.node, (e) => {
				if (e.kind !== 'call') return;
				if (e.key === AUDIT) for (const a of actionsOf(e.node)) out.add(a);
				else for (const a of reach(e.key)) out.add(a);
			});
		}
		return out;
	};
	return reach;
}

/** The capability literals a remote's own handler asks for. */
function capabilitiesOf(g: CallGraph, r: Remote): Set<string> {
	const caps = new Set<string>();
	const mod = g.mod(r.file)!;
	walkEvents(g, mod, r.handler, (e) => {
		if (e.kind !== 'call' || e.key !== CAPABILITY || !ts.isCallExpression(e.node)) return;
		const arg = e.node.arguments[0];
		if (arg && ts.isStringLiteralLike(arg)) caps.add(arg.text);
	});
	return caps;
}

/**
 * Whether a function asks for a capability, itself or through a guard it
 * calls (`requireListingWriter` asks `can('event.manage')`).
 */
function asksCapability(g: CallGraph) {
	const memo = new Map<Key, boolean>();
	const asks = (key: Key): boolean => {
		if (key === CAPABILITY || key === CAN) return true;
		if (key === MEMBERSHIP) return false;
		if (memo.has(key)) return memo.get(key)!;
		memo.set(key, false);
		const body = g.body(key);
		const hit =
			!!body &&
			!!walkEvents(g, body.mod, body.node, (e) =>
				e.kind === 'call' && asks(e.key) ? true : undefined
			);
		memo.set(key, hit);
		return hit;
	};
	return asks;
}

describe('staff changes write an audit row', () => {
	const g = new CallGraph();
	const reach = reachedActions(g);
	const asks = asksCapability(g);
	const remotes = g
		.remotes(sourceFiles(REMOTE_GLOB, new Set()))
		.filter((r) => r.kind === 'form' || r.kind === 'command');

	const inScope = remotes.flatMap((r) => {
		// A member acting on their own records is not a staff change.
		if (!asks(r.key)) return [];
		const caps = capabilitiesOf(g, r);
		const text = r.handler.getText();
		const classes = CLASSES.filter((c) => c.applies(r, caps, text));
		return classes.length ? [{ remote: r, classes }] : [];
	});

	it('finds the remotes', () => {
		// A parser change that drops most of them would otherwise pass vacuously.
		expect(remotes.length).toBeGreaterThan(500);
		expect(inScope.length).toBeGreaterThan(60);
	});

	const answered = (c: AuditClass, actions: Iterable<string>) =>
		[...actions].some((a) => a === '*' || !c.answers || c.answers.test(a));

	it('declares its audit row', () => {
		const bare = inScope
			.filter(({ remote }) => !declarationOf(g, remote))
			.map(({ remote, classes }) => `${remote.key} (${classes.map((c) => c.name).join(', ')})`);
		expect(
			bare,
			`These staff remotes change money, a clearance, a setting, a visibility or a ` +
				`record's existence and declare no audit row. Wrap the handler in audited(...), ` +
				`writesAudit('<action>', ...) or unaudited('<why>', ...) from ` +
				`#lib/server/audit/declared.js:\n${bare.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);
	});

	it('holds each declaration to what the handler reaches', () => {
		const scoped = new Map(inScope.map((s) => [s.remote.key, s.classes]));
		const wrong = remotes.flatMap((r) => {
			const d = declarationOf(g, r);
			if (!d) return [];
			const classes = scoped.get(r.key) ?? [];
			if (d.kind === 'unaudited') {
				if (d.reason.trim().length < 10) return [`${r.key}: give the reason it needs no row`];
				if (!classes.length) return [`${r.key}: changes nothing audited; drop unaudited()`];
				const reached = reach(r.key);
				return reached.size && classes.every((c) => answered(c, reached))
					? [`${r.key}: writes a row; declare writesAudit(...) instead`]
					: [];
			}
			if (!d.actions.length) return [`${r.key}: name the action as a string literal`];
			const misses = classes.filter((c) => !answered(c, d.actions)).map((c) => c.name);
			if (misses.length) return [`${r.key}: no declared action answers ${misses.join(', ')}`];
			if (d.kind === 'audited') return [];
			const reached = reach(r.key);
			const unreached = reached.has('*') ? [] : d.actions.filter((a) => !reached.has(a));
			return unreached.length ? [`${r.key}: never writes ${unreached.join(', ')}`] : [];
		});
		expect(wrong).toEqual([]);
	});
});
