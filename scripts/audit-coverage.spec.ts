import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sourceFiles } from './lib/source-files';
import { CallGraph, walkEvents, type Key, type Remote } from './lib/remote-calls';

/**
 * Workflow gates warn, record and allow; the record is the audit log. A staff
 * change to money, a clearance, a setting, a visibility or a deletion has to
 * reach `recordAuditEntry`, following calls into `src/lib`, or be listed in
 * `audit-coverage.exempt.json` with the reason it needs no row (#2841).
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];
const AUDIT: Key = 'src/lib/server/audit/audit-service.ts#recordAuditEntry';
const CAPABILITY: Key = 'src/lib/server/authorization.ts#requireCapability';
const CAN: Key = 'src/lib/server/authorization.ts#can';

type AuditClass = {
	name: string;
	applies: (r: Remote, caps: Set<string>, text: string) => boolean;
	/** The action a reached row must carry; any action answers when absent. */
	answers?: RegExp;
};

const CLASSES: AuditClass[] = [
	{
		name: 'money',
		applies: (r, caps) =>
			[
				'finance.refund',
				'finance.collect',
				'reservation.comp',
				'credit.adjust',
				'credit.comp'
			].some((c) => caps.has(c)) || /^(comp|refund)/.test(r.name)
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

/** `file#name` → why it changes one of the classes above and writes no row. */
const EXEMPT: Record<string, string> = JSON.parse(
	readFileSync('scripts/audit-coverage.exempt.json', 'utf8')
);

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

	it('reaches recordAuditEntry, or is listed', () => {
		const missing = inScope
			.filter(({ remote, classes }) => {
				const actions = reach(remote.key);
				return classes.some((c) =>
					c.answers
						? ![...actions].some((a) => a === '*' || c.answers!.test(a))
						: actions.size === 0
				);
			})
			.map(({ remote, classes }) => `${remote.key} (${classes.map((c) => c.name).join(', ')})`);
		const offenders = missing.filter((m) => !(m.slice(0, m.indexOf(' ')) in EXEMPT));

		expect(
			offenders,
			`These staff remotes change money, a clearance, a setting, a visibility or ` +
				`a record's existence and write no audit row. Call recordAuditEntry once the ` +
				`write commits, or add the remote to scripts/audit-coverage.exempt.json with ` +
				`the reason it needs none:\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);

		const unanswered = new Set(missing.map((m) => m.slice(0, m.indexOf(' '))));
		const stale = Object.keys(EXEMPT).filter((k) => !unanswered.has(k));
		expect(
			stale,
			`These write an audit row now, or no longer exist. Delete them from ` +
				`scripts/audit-coverage.exempt.json:\n${stale.map((s) => `  ${s}`).join('\n')}\n`
		).toEqual([]);
	});

	it('gives every listed remote a reason', () => {
		const bare = Object.entries(EXEMPT)
			.filter(([, why]) => why.trim().length < 10)
			.map(([k]) => k);
		expect(bare).toEqual([]);
	});
});
