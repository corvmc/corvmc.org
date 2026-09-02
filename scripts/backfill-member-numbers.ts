/**
 * backfill-member-numbers.ts
 *
 * One-off repair. `user.member_number` and its `user_member_number_unique`
 * index shipped with directory profiles, but nothing ever wrote the column
 * outside the dev seed — so it is null for every real account, and
 * `corvmc.org/m/{n}` resolves for nobody. `assignMemberNumber` now issues one
 * at signup (src/lib/server/auth.ts); this gives the accounts that predate it
 * theirs.
 *
 * Deliberately a script and not a migration: `CLAUDE.md` forbids hand-written
 * migrations, `pnpm db:generate` is the only thing allowed to author one, and
 * this is data rather than schema.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-member-numbers.ts [--remote] [--commit]
 *
 * Flags:
 *   --remote   Act on the deployed D1 database (default: the local one)
 *   --commit   Apply the numbers (default: dry run, prints the plan and the SQL)
 *
 * Notes:
 *   - Idempotent. An account that already holds a number is not listed, so a
 *     second run over a numbered database prints "nothing to do" and writes
 *     nothing.
 *   - Numbers follow `created_at`, so they reflect join order. That order is
 *     not treated as sensitive: `/m/{n}` is a public redirect and the
 *     members-panel profile has shown the number since profiles shipped.
 *   - Soft-deleted accounts are numbered too. They keep their place in the
 *     sequence and simply do not resolve — `getUserByMemberNumber` filters
 *     them out, and skipping them would make join order lie.
 *   - Allocation starts one past the highest number already issued, so the
 *     seeded personas (80-83, 90-93, 100+, 999) are never collided with.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const REMOTE = args.includes('--remote');
const COMMIT = args.includes('--commit');
const DB_NAME = 'corvmc-db';

type PendingRow = { id: string; name: string; email: string; created_at: number };

function d1(command: string): unknown[] {
	const out = execFileSync(
		'wrangler',
		['d1', 'execute', DB_NAME, REMOTE ? '--remote' : '--local', '--json', '--command', command],
		{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
	);
	// wrangler prints a banner before the JSON on some versions; take from the
	// first bracket so the parse doesn't depend on that.
	const parsed = JSON.parse(out.slice(out.indexOf('[')));
	return parsed[0]?.results ?? [];
}

function d1File(sql: string): void {
	const path = join(tmpdir(), `backfill-member-numbers-${randomUUID()}.sql`);
	writeFileSync(path, sql, 'utf8');
	try {
		execFileSync(
			'wrangler',
			['d1', 'execute', DB_NAME, REMOTE ? '--remote' : '--local', '--file', path],
			{ encoding: 'utf8', stdio: 'inherit', maxBuffer: 32 * 1024 * 1024 }
		);
	} finally {
		unlinkSync(path);
	}
}

// `id` last in the sort so two accounts created in the same second get a stable
// order rather than whatever the scan happens to return.
const PENDING_QUERY = `
SELECT id, name, email, created_at
FROM user
WHERE member_number IS NULL
ORDER BY created_at ASC, id ASC
`.trim();

async function main() {
	console.log(
		`Target: ${REMOTE ? 'REMOTE (deployed)' : 'LOCAL'} | Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`
	);
	console.log();

	const rows = d1(PENDING_QUERY) as PendingRow[];

	if (rows.length === 0) {
		console.log('Nothing to do — every account already holds a member number.');
		return;
	}

	const [maxRow] = d1('SELECT max(member_number) AS n FROM user') as { n: number | null }[];
	let next = (maxRow?.n ?? 0) + 1;

	console.log(`${rows.length} account(s) without a member number; issuing from #${next}.`);
	console.log();

	const statements: string[] = [];
	for (const r of rows) {
		if (typeof r.id !== 'string' || r.id.includes("'")) {
			console.error(`  ! Unexpected id shape (${JSON.stringify(r.id)}); refusing to build SQL.`);
			process.exitCode = 1;
			return;
		}
		const joined = new Date(r.created_at * 1000).toISOString().slice(0, 10);
		console.log(`  #${String(next).padStart(4, '0')}  ${joined}  ${r.name} <${r.email}>`);
		// `member_number IS NULL` in the predicate as well as the SELECT: if a
		// signup lands between the read and the write, the hook's number stands
		// and this statement is a no-op rather than a renumbering.
		statements.push(
			`UPDATE user SET member_number = ${next} WHERE id = '${r.id}' AND member_number IS NULL;`
		);
		next += 1;
	}
	console.log();

	if (!COMMIT) {
		console.log(
			`Dry run — nothing written. Re-run with --commit to apply ${statements.length} statement(s).`
		);
		return;
	}

	d1File(statements.join('\n') + '\n');
	console.log();

	const remaining = d1(PENDING_QUERY) as PendingRow[];
	const dupes = d1(
		'SELECT member_number, count(*) AS n FROM user WHERE member_number IS NOT NULL GROUP BY member_number HAVING count(*) > 1'
	);
	console.log(
		`Verify: ${remaining.length} account(s) still unnumbered, ${dupes.length} duplicate number(s).`
	);
	if (remaining.length > 0 || dupes.length > 0) {
		console.error('Backfill did not fully converge — inspect before proceeding.');
		process.exitCode = 1;
	} else {
		console.log('Done.');
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
