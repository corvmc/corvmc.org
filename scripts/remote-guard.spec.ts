import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';
import { CallGraph, walkEvents, type Key } from './lib/remote-calls';

/**
 * Remote functions are the security boundary: they bypass route and layout
 * loads, so a remote that forgets its guard is open to anyone who can name it.
 * Every exported remote has to reach a guard before it first touches `db`,
 * following calls into `src/lib` and into other remotes, or be listed in
 * `remote-guard.public.json` with the reason it may answer anyone.
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];
const DB: Key = 'src/lib/server/db/index.ts#db';

/**
 * Reads that only find the scope a guard is then asked about: the project a
 * production belongs to, the band a thread belongs to. One may run before the
 * guard; a remote that reaches one and no guard still fails.
 */
const SCOPE_LOOKUPS = new Set<string>([
	'src/lib/server/production/production-scope.ts',
	'src/lib/server/inbox/band-service.ts#bandOfThread',
	'src/lib/server/inbox/group-chat-service.ts#groupOfChatThread',
	'src/lib/server/volunteer/deliverables-service.ts#getDeliverableOwner',
	'src/lib/server/volunteer/deliverables-service.ts#getTaskWorkOrderId',
	'src/lib/server/volunteer/maintenance-schedule-service.ts#getScheduleGroupId',
	'src/lib/server/market/market-service.ts#getMarketProjectId',
	'src/lib/server/market/market-service.ts#getVendorEventId'
]);

/** `file#name` → why it may answer before, or without, a guard. */
const PUBLIC: Record<string, string> = JSON.parse(
	readFileSync('scripts/remote-guard.public.json', 'utf8')
);

type Effect = 'guard' | 'data' | 'scope' | 'none';

function isScopeLookup(key: Key) {
	return SCOPE_LOOKUPS.has(key) || SCOPE_LOOKUPS.has(key.slice(0, key.indexOf('#')));
}

/** What a function does first: refuse an anonymous caller, or read. */
function firstEffects(g: CallGraph) {
	const memo = new Map<Key, Effect>();
	const effect = (key: Key): Effect => {
		if (isScopeLookup(key)) return 'scope';
		if (memo.has(key)) return memo.get(key)!;
		// A cycle answers 'none' while it is being walked.
		memo.set(key, 'none');
		const body = g.body(key);
		let scoped = false;
		const first = body
			? walkEvents<Effect>(g, body.mod, body.node, (e) => {
					if (e.kind === 'session') return 'guard';
					const x = e.kind === 'ref' ? (e.key === DB ? 'data' : 'none') : effect(e.key);
					if (x === 'scope') scoped = true;
					return x === 'guard' || x === 'data' ? x : undefined;
				})
			: undefined;
		const r: Effect = first ?? (scoped ? 'scope' : 'none');
		memo.set(key, r);
		return r;
	};
	return effect;
}

describe('remote functions guard before they read', () => {
	const g = new CallGraph();
	const effect = firstEffects(g);
	const remotes = g.remotes(sourceFiles(REMOTE_GLOB, new Set()));

	it('finds the remotes', () => {
		// A parser change that drops most of them would otherwise pass vacuously.
		expect(remotes.length).toBeGreaterThan(900);
	});

	it('reaches a guard before the first database access, or is listed', () => {
		const unguarded = remotes.filter((r) => effect(r.key) !== 'guard').map((r) => r.key);
		const offenders = unguarded.filter((k) => !(k in PUBLIC));

		expect(
			offenders,
			`These remotes read before any guard, or never reach one. Remote functions ` +
				`bypass layout loads, so start the handler with requireUser(), ` +
				`requireCapability(), requireGroupRole() or another guard. If one is meant ` +
				`to answer anyone, add it to scripts/remote-guard.public.json with the reason:\n` +
				`${offenders.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);

		const stale = Object.keys(PUBLIC).filter((k) => !unguarded.includes(k as Key));
		expect(
			stale,
			`These guard first now, or no longer exist. Delete them from ` +
				`scripts/remote-guard.public.json:\n${stale.map((s) => `  ${s}`).join('\n')}\n`
		).toEqual([]);
	});

	it('gives every listed remote a reason', () => {
		const bare = Object.entries(PUBLIC)
			.filter(([, why]) => why.trim().length < 10)
			.map(([k]) => k);
		expect(bare).toEqual([]);
	});
});
