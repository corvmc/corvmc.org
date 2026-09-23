// Apply pending D1 migrations to remote, but ONLY for a build that publishes to production.
// Two invocations from the Cloudflare Workers Builds dashboard, which code review cannot see:
// `pnpm ci:migrate` in the build command, ahead of `pnpm build`, and
// `pnpm ci:migrate --after-publish` in the deploy command, after `wrangler deploy`.
// docs/architecture/operations-manual.md §1 has both fields. When the dashboard lost the first
// one (#267), a rename shipped without its migration and every band route 500ed.
//
// Requires CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_TOKEN in the build environment.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const PROD_BRANCH = 'main';
// GitHub's merge queue builds each entry on a temporary branch named
// `gh-readonly-queue/<base>/pr-<n>-<sha>`, and Cloudflare builds *that* branch and publishes
// it to production. It does not build again when the queue fast-forwards `main` onto the
// identical SHA, so this is the only build a queued PR ever gets: treating it as anything
// other than production ships the code and skips its migrations. Scoped to the queue for
// `main` specifically — a queue on another base is not production.
const PROD_QUEUE_PREFIX = `gh-readonly-queue/${PROD_BRANCH}/`;

// Set in the build environment only once the deploy command runs `--after-publish`. Unset,
// every migration runs before publish, as it always did: a drop then breaks the live Worker for
// the length of the build, but nothing is ever skipped.
const AFTER_PUBLISH_FLAG = 'CMC_MIGRATE_AFTER_PUBLISH';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/**
 * Does a build on this branch publish to production, and so need the schema applied first?
 *
 * @param {string} branch
 */
export function isProductionBranch(branch) {
	return branch === PROD_BRANCH || branch.startsWith(PROD_QUEUE_PREFIX);
}

/** @param {string} sql */
function statements(sql) {
	return sql
		.replaceAll('--> statement-breakpoint', ';')
		.replace(/--.*$/gm, '')
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
}

const DROP_COLUMN = /^ALTER TABLE\s+\S+\s+DROP COLUMN\b/i;
const DROP_TABLE = /^DROP TABLE\s+(?:IF EXISTS\s+)?[`"]?([\w]+)[`"]?$/i;
// Neither breaks a query on either side of the publish.
const NEUTRAL = /^(?:PRAGMA\b|DROP INDEX\b)/i;

/**
 * `contract` removes a column or table and nothing else, so it is safe only once the Worker
 * that reads it is gone. A table rebuild drops and recreates under the same name; that is expand.
 *
 * @param {string} sql
 * @returns {'contract' | 'expand' | 'mixed'}
 */
export function classifyMigration(sql) {
	const stmts = statements(sql);
	// Created or renamed into place in this same file: a rebuild or a scratch table.
	const rebuilt = new Set(
		stmts.flatMap(
			(s) =>
				/(?:\bRENAME TO|^CREATE TABLE(?: IF NOT EXISTS)?)\s+[`"]?(\w+)[`"]?/i.exec(s)?.[1] ?? []
		)
	);
	let contract = false;
	let expand = false;
	for (const s of stmts) {
		const dropped = DROP_TABLE.exec(s)?.[1];
		if (NEUTRAL.test(s) || (dropped && rebuilt.has(dropped))) continue;
		if (DROP_COLUMN.test(s) || dropped) contract = true;
		else expand = true;
	}
	if (contract && expand) return 'mixed';
	return contract ? 'contract' : 'expand';
}

/**
 * The folders `drizzle-kit migrate` would apply: those whose name it has not recorded.
 *
 * @param {string[]} local
 * @param {string[]} applied
 */
export function pendingMigrations(local, applied) {
	const done = new Set(applied);
	return [...local].sort().filter((name) => !done.has(name));
}

/**
 * When the pending batch may run. `drizzle-kit migrate` applies all of it in one go, so a batch
 * that needs both sides of the publish cannot be split and is refused instead.
 *
 * @param {{ name: string, kind: 'contract' | 'expand' | 'mixed' }[]} pending
 * @returns {{ when: 'none' | 'before' | 'after' } | { when: 'refuse', reason: string }}
 */
export function planMigrate(pending) {
	if (pending.length === 0) return { when: 'none' };
	const mixed = pending.filter((m) => m.kind === 'mixed');
	const contract = pending.filter((m) => m.kind === 'contract');
	const expand = pending.filter((m) => m.kind === 'expand');
	if (mixed.length > 0) {
		return {
			when: 'refuse',
			reason:
				`${mixed.map((m) => m.name).join(', ')} both adds and drops. Ship the drop in a ` +
				`PR of its own, after the one that stops reading the column has deployed.`
		};
	}
	if (contract.length > 0 && expand.length > 0) {
		return {
			when: 'refuse',
			reason:
				`Pending migrations need both sides of the publish: ` +
				`${expand.map((m) => m.name).join(', ')} before it, ` +
				`${contract.map((m) => m.name).join(', ')} after it. Ship the drop in a PR of its ` +
				`own. If a drop was already deployed, the deploy command is not running ` +
				`\`ci:migrate --after-publish\`.`
		};
	}
	return { when: contract.length > 0 ? 'after' : 'before' };
}

/**
 * The migration names production has recorded, read over the D1 HTTP API.
 *
 * @param {{ accountId: string, databaseId: string, token: string }} creds
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[]>}
 */
export async function appliedMigrationNames(creds, fetchImpl = fetch) {
	const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/d1/database/${creds.databaseId}/query`;
	const res = await fetchImpl(url, {
		method: 'POST',
		headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ sql: 'SELECT name FROM __drizzle_migrations' })
	});
	const body = await res.json();
	if (!body.success) {
		throw new Error(`Reading __drizzle_migrations failed: ${JSON.stringify(body.errors)}`);
	}
	/** @type {{ name: string | null }[]} */
	const rows = body.result[0]?.results ?? [];
	return rows.flatMap((r) => (r.name ? [r.name] : []));
}

function databaseId() {
	if (process.env.CLOUDFLARE_DATABASE_ID) return process.env.CLOUDFLARE_DATABASE_ID;
	const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
	const id = /^\s*database_id\s*=\s*["']([^"']+)["']/m.exec(toml)?.[1];
	if (!id) throw new Error('No database_id in wrangler.toml');
	return id;
}

async function planFromRemote() {
	const local = readdirSync(MIGRATIONS, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/migration.sql`, MIGRATIONS)))
		.map((d) => d.name);
	const applied = await appliedMigrationNames({
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		databaseId: databaseId(),
		token: process.env.CLOUDFLARE_D1_TOKEN ?? ''
	});
	const pending = pendingMigrations(local, applied).map((name) => ({
		name,
		kind: classifyMigration(readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8'))
	}));
	for (const m of pending) console.log(`ci:migrate — pending ${m.name} (${m.kind})`);
	return planMigrate(pending);
}

function migrate() {
	execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], { stdio: 'inherit' });
}

async function main() {
	// Workers Builds exposes the branch as WORKERS_CI_BRANCH; older Pages builds use CF_PAGES_BRANCH.
	const branch = process.env.WORKERS_CI_BRANCH ?? process.env.CF_PAGES_BRANCH ?? '';
	const afterPublish = process.argv.includes('--after-publish');

	if (!isProductionBranch(branch)) {
		console.log(
			`ci:migrate — branch "${branch || '(unknown)'}" is neither "${PROD_BRANCH}" nor a "${PROD_QUEUE_PREFIX}*" merge queue branch, skipping remote migrate.`
		);
		return;
	}

	const kind = branch === PROD_BRANCH ? 'production branch' : 'production merge queue';
	if (afterPublish) {
		// Whatever the build step left pending is contract-only by construction.
		console.log(`ci:migrate — applying deferred D1 migrations after publish (${kind})…`);
		return migrate();
	}

	if (process.env[AFTER_PUBLISH_FLAG] !== '1') {
		console.log(`ci:migrate — ${AFTER_PUBLISH_FLAG} unset, so every migration runs now.`);
	} else {
		const plan = await planFromRemote();
		if (plan.when === 'refuse') {
			console.error(`ci:migrate — refusing to deploy. ${plan.reason}`);
			process.exit(1);
		}
		if (plan.when === 'none') return console.log('ci:migrate — nothing pending.');
		if (plan.when === 'after') {
			return console.log('ci:migrate — contract-only batch, deferred to --after-publish.');
		}
	}
	console.log(`ci:migrate — applying D1 migrations to remote (${kind}, branch "${branch}")…`);
	migrate();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
