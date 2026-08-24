/**
 * backfill-band-owners.ts
 *
 * One-off repair. Band ownership is stored twice — `band.owner_id` and the
 * `band_member` row whose `role` is `'owner'` — and only `create()` writes both
 * in one batch. The Postgres migrator took the two from different legacy tables
 * without reconciling them, so a migrated band can have an owner who is recorded
 * as `admin`, or who has no membership row at all. Since `requireBandOwner`
 * reads only `band_member.role`, such a band has no owner in practice: no
 * address change, no delete, no transfer, no subscription, no custom domain, and
 * no Settings nav item.
 *
 * This brings `band_member` into agreement with `band.owner_id`.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-band-owners.ts [--remote] [--commit]
 *
 * Flags:
 *   --remote   Act on the deployed D1 database (default: the local one)
 *   --commit   Apply the repair (default: dry run, prints the plan and the SQL)
 *
 * Notes:
 *   - Idempotent. A band already holding a correct owner row is not listed.
 *   - A band whose `role='owner'` row belongs to somebody *other* than
 *     `band.owner_id` is reported and skipped, never guessed: that is two
 *     records disagreeing about who owns the band, and a human has to pick.
 *   - Run this BEFORE creating the `idx_band_member_single_owner` index. The
 *     index constrains bands that have an owner row; it says nothing about the
 *     ones missing theirs, so repairing first is what makes it meaningful.
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

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

type DriftRow = {
	band_id: string;
	slug: string;
	owner_id: string;
	member_role: string | null;
	member_status: string | null;
	other_owner_rows: number;
};

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
	const path = join(tmpdir(), `backfill-band-owners-${randomUUID()}.sql`);
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

const DRIFT_QUERY = `
SELECT b.id AS band_id, b.slug, b.owner_id,
       m.role AS member_role, m.status AS member_status,
       (SELECT count(*) FROM band_member x
         WHERE x.band_id = b.id AND x.role = 'owner' AND x.user_id != b.owner_id) AS other_owner_rows
FROM band b
LEFT JOIN band_member m ON m.band_id = b.id AND m.user_id = b.owner_id
WHERE b.deleted_at IS NULL
  AND (m.user_id IS NULL OR m.role != 'owner' OR m.status != 'active')
ORDER BY b.slug
`.trim();

async function main() {
	console.log(
		`Target: ${REMOTE ? 'REMOTE (deployed)' : 'LOCAL'} | Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`
	);
	console.log();

	const rows = d1(DRIFT_QUERY) as DriftRow[];

	if (rows.length === 0) {
		console.log('Nothing to repair — every active band has an owner row matching band.owner_id.');
		return;
	}

	const promote: DriftRow[] = [];
	const insert: DriftRow[] = [];
	const skip: DriftRow[] = [];

	for (const r of rows) {
		if (!UUID_RE.test(r.band_id) || !UUID_RE.test(r.owner_id)) {
			console.error(`  ! Unexpected id shape on ${r.slug}; refusing to build SQL for it.`);
			skip.push(r);
		} else if (r.other_owner_rows > 0) {
			skip.push(r);
		} else if (r.member_role === null) {
			insert.push(r);
		} else {
			promote.push(r);
		}
	}

	console.log(`${rows.length} band(s) without a usable owner row:`);
	for (const r of promote) {
		console.log(
			`  promote  ${r.slug} — owner is recorded as '${r.member_role}' (${r.member_status})`
		);
	}
	for (const r of insert) {
		console.log(`  insert   ${r.slug} — owner has no membership row`);
	}
	for (const r of skip) {
		console.log(
			`  SKIP     ${r.slug} — ${r.other_owner_rows} other row(s) already claim owner; resolve by hand`
		);
	}
	console.log();

	const statements = [
		...promote.map(
			(r) =>
				`UPDATE band_member SET role = 'owner', status = 'active' ` +
				`WHERE band_id = '${r.band_id}' AND user_id = '${r.owner_id}';`
		),
		...insert.map(
			(r) =>
				`INSERT INTO band_member (id, band_id, user_id, role, status) ` +
				`VALUES ('${randomUUID()}', '${r.band_id}', '${r.owner_id}', 'owner', 'active');`
		)
	];

	if (statements.length === 0) {
		console.log('No statements to run (everything needs manual resolution).');
		process.exitCode = 1;
		return;
	}

	console.log('SQL:');
	for (const s of statements) console.log(`  ${s}`);
	console.log();

	if (!COMMIT) {
		console.log(
			`Dry run — nothing written. Re-run with --commit to apply ${statements.length} statement(s).`
		);
		return;
	}

	d1File(statements.join('\n') + '\n');
	console.log();

	const remaining = d1(DRIFT_QUERY) as DriftRow[];
	const dupes = d1(
		`SELECT band_id, count(*) AS n FROM band_member WHERE role = 'owner' GROUP BY band_id HAVING count(*) != 1`
	);
	console.log(
		`Verify: ${remaining.length} band(s) still without an owner row, ${dupes.length} band(s) with a duplicate owner row.`
	);
	if (remaining.length > skip.length || dupes.length > 0) {
		console.error('Repair did not fully converge — inspect before proceeding.');
		process.exitCode = 1;
	} else {
		console.log('Done.');
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
