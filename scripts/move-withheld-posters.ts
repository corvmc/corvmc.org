/**
 * move-withheld-posters.ts — one-off for #771.
 *
 * Every poster taken down before that change sits at an
 * `events/posters/withheld/` key in the **public** bucket, still fetchable by
 * anyone holding it. This moves those objects into `corvmc-private`.
 */

// Usage:  pnpm tsx scripts/move-withheld-posters.ts [--remote] [--commit]
//   --remote   Act on the deployed buckets (default: the local miniflare ones)
//   --commit   Actually move (default: dry run, prints what it would do)
//
// **Not run against production by this change.** The dry run is safe, but the
// move deletes public objects, so the owner runs it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const REMOTE = args.includes('--remote');
const COMMIT = args.includes('--commit');

const PUBLIC_BUCKET = 'corvmc';
const PRIVATE_BUCKET = 'corvmc-private';
const PREFIX = 'events/posters/withheld/';

const scope = REMOTE ? '--remote' : '--local';

/**
 * Every withheld key the database knows, from both places one can be recorded.
 *
 * `wrangler r2` has no list-objects subcommand, so the bucket cannot be walked
 * from here. An object whose row is already gone is therefore out of reach of
 * this script and stays for the media sweep, which now deletes by key shape.
 */
function withheldKeysFromDb(): string[] {
	const sql = `SELECT key FROM media WHERE key LIKE '${PREFIX}%' UNION SELECT poster_key AS key FROM event_listing WHERE poster_key LIKE '${PREFIX}%'`;
	const out = execFileSync(
		'wrangler',
		['d1', 'execute', 'corvmc-db', scope, '--json', '--command', sql],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
	);
	const parsed = JSON.parse(out.slice(out.indexOf('[')));
	return (parsed[0]?.results ?? []).map((r: { key: string }) => r.key).filter(Boolean);
}

function r2(subcommand: string[], quiet = false): void {
	execFileSync('wrangler', ['r2', 'object', ...subcommand, scope], {
		encoding: 'utf8',
		stdio: quiet ? 'pipe' : 'inherit'
	});
}

/**
 * Copy first, verify, then delete — the same ordering the takedown path itself
 * holds, and the reason this is safe to re-run. A failed copy leaves the public
 * object in place; the next run finds it again.
 */
function move(key: string, dir: string): 'moved' | 'missing' | 'failed' {
	const local = join(dir, key.replaceAll('/', '_'));

	try {
		r2(['get', `${PUBLIC_BUCKET}/${key}`, '--file', local], true);
	} catch {
		return 'missing';
	}
	if (!existsSync(local) || statSync(local).size === 0) return 'missing';

	try {
		r2(['put', `${PRIVATE_BUCKET}/${key}`, '--file', local], true);
		r2(['delete', `${PUBLIC_BUCKET}/${key}`], true);
		return 'moved';
	} catch {
		return 'failed';
	}
}

const keys = [...new Set(withheldKeysFromDb())];
console.log(`${keys.length} withheld key(s) under ${PREFIX} in ${scope} D1`);

if (!COMMIT) {
	for (const key of keys) console.log(`  would move ${PUBLIC_BUCKET}/${key} -> ${PRIVATE_BUCKET}`);
	console.log('\nDry run. Re-run with --commit to move them.');
	process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'withheld-'));
const tally = { moved: 0, missing: 0, failed: 0 };
try {
	for (const key of keys) {
		const outcome = move(key, dir);
		tally[outcome]++;
		console.log(`  ${outcome.padEnd(7)} ${key}`);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(`\nmoved ${tally.moved}, already gone ${tally.missing}, failed ${tally.failed}`);
process.exit(tally.failed > 0 ? 1 : 0);
