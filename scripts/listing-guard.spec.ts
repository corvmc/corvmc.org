import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sourceFiles } from './lib/source-files';
import { CallGraph, walkEvents, type Key, type Remote } from './lib/remote-calls';

/**
 * A listing is read and written by org staff and by the show's committee, and
 * only `requireListingReader`/`requireListingWriter` admit the committee half.
 * A remote keyed on an event id that guards with `requireCapability('event.*')`
 * refuses a committee producer with a 403 nobody sees until one hits it (#2002,
 * #2031). Each such remote reaches a listing guard, is public, or is listed in
 * `listing-guard.json` with the reason the committee is not meant to reach it.
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];
const LISTING_GUARDS = new Set<Key>([
	'src/lib/server/event/listing-guard.ts#requireListingReader',
	'src/lib/server/event/listing-guard.ts#requireListingWriter'
]);
/** Where a bare `id` is the listing's. Elsewhere it names something else. */
const ID_IS_EVENT = new Set(['src/lib/remote/events.remote.ts']);

const PUBLIC: Record<string, string> = JSON.parse(
	readFileSync('scripts/remote-guard.public.json', 'utf8')
);
const NOT_LISTING: Record<string, string> = JSON.parse(
	readFileSync('scripts/listing-guard.json', 'utf8')
);

const EVENT_KEY = /^eventId$/;

/** The handler's own parameter names, top-level and destructured. */
function paramNames(r: Remote): string[] {
	const fn = r.handler.parent;
	if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return [];
	const first = fn.parameters[0]?.name;
	if (!first) return [];
	if (ts.isIdentifier(first)) return [first.text];
	if (ts.isObjectBindingPattern(first)) {
		return first.elements.map((el) => (el.propertyName ?? el.name).getText());
	}
	return [];
}

/** Property names declared anywhere in the schema, following local consts. */
function schemaKeys(g: CallGraph, r: Remote): string[] {
	const sf = g.mod(r.file)?.sf;
	if (!r.schema || !sf) return [];
	const consts = new Map<string, ts.Expression>();
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		for (const d of st.declarationList.declarations) {
			if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
		}
	}
	const keys: string[] = [];
	const seen = new Set<string>();
	const visit = (n: ts.Node): void => {
		if (ts.isIdentifier(n) && consts.has(n.text) && !seen.has(n.text)) {
			seen.add(n.text);
			// A schema const named for the field: `query(eventId, …)`.
			keys.push(n.text);
			visit(consts.get(n.text)!);
		}
		if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n))
			keys.push(n.name.getText());
		ts.forEachChild(n, visit);
	};
	visit(r.schema);
	return keys;
}

function keyedOnListing(g: CallGraph, r: Remote): boolean {
	const names = [...paramNames(r), ...schemaKeys(g, r)];
	if (names.some((n) => EVENT_KEY.test(n))) return true;
	return ID_IS_EVENT.has(r.file) && names.includes('id');
}

const AUTH = 'src/lib/server/authorization.ts';

/** `requireCapability('event.…')` or `can('event.…')`: the staff half on its own. */
function isEventCapability(e: { kind: string; key: Key; node: ts.Node }): boolean {
	if (e.kind !== 'call' || !ts.isCallExpression(e.node)) return false;
	if (e.key !== `${AUTH}#requireCapability` && e.key !== `${AUTH}#can`) return false;
	const cap = e.node.arguments[0];
	return !!cap && ts.isStringLiteralLike(cap) && cap.text.startsWith('event.');
}

/** Whether a function reaches a call `hit` accepts, following calls. */
function reachesCall(g: CallGraph, hit: (e: Parameters<typeof isEventCapability>[0]) => boolean) {
	const memo = new Map<Key, boolean>();
	const reaches = (key: Key): boolean => {
		if (memo.has(key)) return memo.get(key)!;
		memo.set(key, false);
		const body = g.body(key);
		const r =
			!!body &&
			walkEvents<true>(g, body.mod, body.node, (e) =>
				hit(e) || (e.kind === 'call' && reaches(e.key)) ? true : undefined
			) === true;
		memo.set(key, r);
		return r;
	};
	return reaches;
}

describe('remotes keyed on a listing go through the listing guards', () => {
	const g = new CallGraph();
	const listingGuard = reachesCall(g, (e) => e.kind === 'call' && LISTING_GUARDS.has(e.key));
	const eventCapability = reachesCall(g, isEventCapability);
	const keyed = g
		.remotes(sourceFiles(REMOTE_GLOB, new Set()))
		.filter((r) => keyedOnListing(g, r) && !(r.key in PUBLIC));

	it('finds the listing remotes', () => {
		// A parser change that finds none would otherwise pass vacuously.
		expect(keyed.filter((r) => listingGuard(r.key)).length).toBeGreaterThan(5);
	});

	it('reaches requireListingReader or requireListingWriter, or is listed', () => {
		const bypassing = keyed
			.filter((r) => eventCapability(r.key) && !listingGuard(r.key))
			.map((r) => r.key);
		const offenders = bypassing.filter((k) => !(k in NOT_LISTING));

		expect(
			offenders,
			`These take an event id but never reach requireListingReader/Writer, so the ` +
				`show's committee is refused. Guard with the listing guard, or, if the ` +
				`committee is not meant to reach it, add it to scripts/listing-guard.json ` +
				`with the reason:\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);

		const stale = Object.keys(NOT_LISTING).filter((k) => !bypassing.includes(k as Key));
		expect(
			stale,
			`These reach a listing guard now, are public, or no longer exist. Delete them ` +
				`from scripts/listing-guard.json:\n${stale.map((s) => `  ${s}`).join('\n')}\n`
		).toEqual([]);
	});

	it('gives every listed remote a reason', () => {
		const bare = Object.entries(NOT_LISTING)
			.filter(([, why]) => why.trim().length < 10)
			.map(([k]) => k);
		expect(bare).toEqual([]);
	});
});
