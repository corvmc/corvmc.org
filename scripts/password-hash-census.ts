/**
 * password-hash-census.ts
 *
 * How many accounts still depend on the legacy Laravel server to sign in.
 *
 * `src/lib/server/auth.ts` verifies a `$2*` (bcrypt) hash by proxying to
 * `LARAVEL_URL`, because bcrypt-ts silently returns `false` in 0ms on Workers.
 * Every account still carrying one therefore depends on that box staying up,
 * and the failure mode if it goes away is indistinguishable from a wrong
 * password. This counts them, so the switch-off is a decision about a number
 * rather than a guess.
 *
 * The set only shrinks: a successful bcrypt verify rewrites the hash to scrypt
 * on the way through. So an account listed here is one that has not signed in
 * since the migration, and running this again after any interval says whether
 * that is still true.
 *
 * Read-only. It issues SELECTs and nothing else, which is why `--remote` needs
 * no confirmation flag.
 *
 * Usage:
 *   pnpm tsx scripts/password-hash-census.ts [--remote] [--emails]
 *
 * Flags:
 *   --remote   Count the deployed D1 database (default: the local one)
 *   --emails   Also print the addresses still on a legacy hash, one per line,
 *              so they can be fed to whatever sends the reset. Off by default:
 *              this is a list of members' email addresses and it should take a
 *              deliberate keystroke to put it on a terminal.
 *
 * Note the exit from bcrypt is password reset, not a migration script — a reset
 * never checks the old password, so any account below can already recover
 * without the Laravel box. See #623.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const REMOTE = args.includes('--remote');
const EMAILS = args.includes('--emails');
const DB_NAME = 'corvmc-db';

function d1(command: string): Record<string, unknown>[] {
	const out = execFileSync(
		'wrangler',
		['d1', 'execute', DB_NAME, REMOTE ? '--remote' : '--local', '--json', '--command', command],
		{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
	);
	// wrangler prints a banner before the JSON on some versions; take from the
	// first bracket so the parse does not depend on that.
	const parsed = JSON.parse(out.slice(out.indexOf('['))) as {
		results?: Record<string, unknown>[];
	}[];
	return parsed[0]?.results ?? [];
}

// `$2` covers $2a$, $2b$ and $2y$ alike. The three branches here are exactly the
// three `verify` handles in auth.ts, plus a catch-all so a scheme nobody
// remembers cannot hide inside "scrypt".
const CENSUS = `
SELECT
  SUM(CASE WHEN a.password LIKE '$2%' THEN 1 ELSE 0 END)      AS bcrypt,
  SUM(CASE WHEN a.password LIKE 'pbkdf2:%' THEN 1 ELSE 0 END) AS pbkdf2,
  SUM(CASE WHEN a.password LIKE 'scrypt:%' THEN 1 ELSE 0 END) AS scrypt,
  SUM(CASE WHEN a.password IS NULL THEN 1 ELSE 0 END)         AS no_password,
  SUM(CASE WHEN a.password IS NOT NULL
            AND a.password NOT LIKE '$2%'
            AND a.password NOT LIKE 'pbkdf2:%'
            AND a.password NOT LIKE 'scrypt:%' THEN 1 ELSE 0 END) AS unrecognised,
  COUNT(*) AS total
FROM account a
WHERE a.provider_id = 'credential'
`.trim();

// Deactivated users are counted separately: they cannot sign in at all, so they
// are not part of the population a forced reset has to reach.
const LEGACY_DETAIL = `
SELECT u.email, u.deleted_at IS NOT NULL AS deactivated,
       (SELECT MAX(s.created_at) FROM session s WHERE s.user_id = u.id) AS last_session_at
FROM account a
JOIN user u ON u.id = a.user_id
WHERE a.provider_id = 'credential'
  AND (a.password LIKE '$2%' OR a.password LIKE 'pbkdf2:%')
ORDER BY u.email
`.trim();

function n(value: unknown): number {
	return Number(value ?? 0);
}

const [counts] = d1(CENSUS);
if (!counts) {
	console.error('No credential accounts found. Is the database seeded?');
	process.exit(1);
}

const legacy = d1(LEGACY_DETAIL);
const active = legacy.filter((r) => !n(r.deactivated));
const everSignedIn = active.filter((r) => r.last_session_at != null);

console.log(`\nPassword hashes — ${REMOTE ? 'PRODUCTION' : 'local'} (${DB_NAME})\n`);
console.log(`  scrypt (current)        ${n(counts.scrypt)}`);
console.log(`  bcrypt (needs Laravel)  ${n(counts.bcrypt)}`);
console.log(`  pbkdf2 (legacy)         ${n(counts.pbkdf2)}`);
if (n(counts.no_password) > 0) console.log(`  no password             ${n(counts.no_password)}`);
if (n(counts.unrecognised) > 0) {
	console.log(`  UNRECOGNISED            ${n(counts.unrecognised)}  <- verify() returns false`);
}
console.log(`  ${'─'.repeat(24)}`);
console.log(`  total credential        ${n(counts.total)}\n`);

if (legacy.length === 0) {
	console.log('Nothing depends on the legacy server. LARAVEL_URL, MIGRATION_SECRET');
	console.log('and the $2/pbkdf2 branches in auth.ts can go, and the Forge box with');
	console.log('them. See #623 for the rest of the exit.\n');
	process.exit(0);
}

console.log(`${active.length} of those ${legacy.length} belong to an active account.`);
console.log(`${everSignedIn.length} have ever held a session on this app.\n`);
console.log('Each can still recover unaided — a password reset never checks the old');
console.log('password and re-hashes to scrypt — so this is a number to drive down,');
console.log('not an outage. The Laravel box can go once it reaches zero.\n');

if (EMAILS) {
	console.log('Addresses still on a legacy hash:\n');
	for (const row of active) console.log(`  ${row.email}`);
	console.log('');
} else {
	console.log('Re-run with --emails to list the addresses.\n');
}
