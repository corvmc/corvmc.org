#!/usr/bin/env node
// Fails when anything under `e2e/` or `scripts/` imports a name that no longer
// exists — the one failure mode those trees have no cover for at all.
//
// `pnpm check` runs svelte-check against `.svelte-kit/tsconfig.json`, whose
// `include` is `src` and nothing else. Seeds, e2e fixtures and the db scripts are
// real code against the real schema, and a stale import in them typechecks clean
// and then dies at runtime — `e2e/fixtures/seed-venues.ts` still naming `event`
// after #527 took down the whole E2E job in `prepare`, before a test ran.
//
// **This is deliberately not a full typecheck of those trees.** They carry ~40
// pre-existing errors (implicit anys in seed helpers, a couple of real ones in
// `scripts/backfill-media.ts` and `scripts/email-validate.ts`), and fixing those
// is its own piece of work. Gating on the import/export family gets the failure
// that actually breaks CI today without blocking on that cleanup. Widening this
// to every code is the follow-up, once the backlog above is cleared.
import { spawnSync } from 'node:child_process';

/** The "you are importing something that isn't there" family. */
const IMPORT_ERRORS = new Set([
	2305, // module has no exported member 'X'
	2306, // file is not a module
	2307, // cannot find module
	2459, // module declares 'X' locally, but it is not exported
	2613, // module has no default export
	2614, // no exported member (did you mean import default?)
	2724 // has no exported member named 'X'; did you mean 'Y'?
]);

const { stdout } = spawnSync(
	'node_modules/.bin/tsc',
	['-p', 'tsconfig.tooling.json', '--pretty', 'false'],
	{ encoding: 'utf8' }
);

const line = /^(e2e|scripts)\/(\S+)\((\d+),\d+\): error TS(\d+): (.*)$/;
const offenders = [];
for (const raw of stdout.split('\n')) {
	const m = raw.match(line);
	if (!m) continue;
	if (!IMPORT_ERRORS.has(Number(m[4]))) continue;
	offenders.push(`  ${m[1]}/${m[2]}:${m[3]}  TS${m[4]} ${m[5]}`);
}

if (offenders.length) {
	console.error(`Broken imports in e2e/ or scripts/ (${offenders.length}):\n`);
	console.error(offenders.join('\n'));
	console.error('\nThese trees are outside `pnpm check`. Fix the import, or export the name.');
	process.exit(1);
}
console.log('tooling imports: e2e/ and scripts/ resolve every name they import');
