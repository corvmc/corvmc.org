// Apply pending D1 migrations to remote, but ONLY for a build that publishes to production.
// Three invocations from the Cloudflare Workers Builds dashboard, which code review cannot see:
// `pnpm ci:migrate` in the build command; `pnpm ci:migrate --before-publish` ahead of
// `wrangler deploy`, which refuses a build older than production's schema (#3411); and
// `pnpm ci:migrate --after-publish` after it. `--check-pr` is CI's check that a drop ships alone.
// docs/architecture/operations-manual.md §1 has the fields. When the dashboard lost the first
// one (#267), a rename shipped without its migration and every band route 500ed.
//
// Requires CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_TOKEN in the build environment.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { readSnapshot } from './db/d1-ddl.mjs';

const PROD_BRANCH = 'main';
// GitHub's merge queue builds each entry on a temporary branch named
// `gh-readonly-queue/<base>/pr-<n>-<sha>`, and Cloudflare builds *that* branch and publishes
// it to production. It does not build again when the queue fast-forwards `main` onto the
// identical SHA, so this is the only build a queued PR ever gets: treating it as anything
// other than production ships the code and skips its migrations. Scoped to the queue for
// `main` specifically — a queue on another base is not production.
const PROD_QUEUE_PREFIX = `gh-readonly-queue/${PROD_BRANCH}/`;

// Set in the build environment only once the deploy command runs `--after-publish`. Unset, a
// batch holding a drop is refused: running it before publish breaks the live Worker (#3411).
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
	const pieces = sql
		.replaceAll('--> statement-breakpoint', ';')
		.replace(/--.*$/gm, '')
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
	// A trigger body holds its own semicolons; keep it one statement through its `END`.
	const out = [];
	for (let i = 0; i < pieces.length; i++) {
		let s = pieces[i];
		if (/^CREATE TRIGGER\b/i.test(s)) {
			while (!/\bEND$/i.test(s) && i + 1 < pieces.length) s += `; ${pieces[++i]}`;
		}
		out.push(s);
	}
	return out;
}

const DROP_COLUMN = /^ALTER TABLE\s+\S+\s+DROP COLUMN\b/i;
const DROP_TABLE = /^DROP TABLE\s+(?:IF EXISTS\s+)?[`"]?([\w]+)[`"]?$/i;
// Neither breaks a query on either side of the publish.
const NEUTRAL = /^(?:PRAGMA\b|DROP INDEX\b)/i;
// A rebuild's own scratch tables: drizzle's `__new_`, and d1-safe-rebuild's detach and reattach.
const SCRATCH = /^__(?:new|detach|reattach)_(\w+)$/;
const ON_TABLE = /^CREATE (?:UNIQUE INDEX|INDEX|TRIGGER)\b[\s\S]*?\bON\s+[`"]?(\w+)[`"]?/i;
const INTO = /^INSERT INTO\s+[`"]?(\w+)[`"]?/i;

/**
 * Tables drizzle rebuilt, whose old columns `classifyMigration` needs. d1-safe-rebuild's
 * detach and reattach copies keep every column by construction, so they are not listed.
 *
 * @param {string} sql
 */
export function rebuiltTables(sql) {
	return [
		...new Set(
			statements(sql).flatMap((s) => /^CREATE TABLE\s+[`"]?__new_(\w+)[`"]?/i.exec(s)?.[1] ?? [])
		)
	];
}

/** @param {string} create */
function createdColumns(create) {
	const body = create.slice(create.indexOf('(') + 1, create.lastIndexOf(')'));
	return body.split('\n').flatMap((line) => /^\s*[`"](\w+)[`"]/.exec(line)?.[1] ?? []);
}

/**
 * `contract` removes a column or table and nothing else, so it is safe only once the Worker
 * that reads it is gone. `columns` holds each rebuilt table's columns before the migration:
 * a rebuild that loses one and gains none is contract, and one that loses none is expand.
 * Its copies, index and trigger re-creations change nothing either side of the publish.
 *
 * @param {string} sql
 * @param {Map<string, string[]>} [columns]
 * @returns {'contract' | 'expand' | 'mixed'}
 */
export function classifyMigration(sql, columns = new Map()) {
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
		const created = /^CREATE TABLE\s+[`"]?(\w+)[`"]?/i.exec(s)?.[1];
		const scratchOf = created && SCRATCH.exec(created)?.[1];
		if (created?.startsWith('__new_') && scratchOf) {
			const before = columns.get(scratchOf);
			const after = createdColumns(s);
			const lost = before?.some((c) => !after.includes(c)) ?? false;
			// Keeping every column means it changed a constraint, which new code may rely on.
			if (lost) contract = true;
			if (!lost || after.some((c) => !before?.includes(c))) expand = true;
			continue;
		}
		if (scratchOf) continue;
		const dropped = DROP_TABLE.exec(s)?.[1];
		const into = INTO.exec(s)?.[1];
		const on = ON_TABLE.exec(s)?.[1];
		const renamed = /^ALTER TABLE\s+[`"]?(\w+)[`"]?\s+RENAME TO\b/i.exec(s)?.[1];
		if (
			NEUTRAL.test(s) ||
			(dropped && rebuilt.has(dropped)) ||
			(into && SCRATCH.test(into)) ||
			(renamed && SCRATCH.test(renamed)) ||
			(on && rebuilt.has(on) && dropsTable(stmts, on))
		) {
			continue;
		}
		if (DROP_COLUMN.test(s) || dropped) contract = true;
		else expand = true;
	}
	if (contract && expand) return 'mixed';
	return contract ? 'contract' : 'expand';
}

/** Whether `table` is dropped in this file, so an index or trigger on it is a re-creation. */
/** @param {string[]} stmts @param {string} table */
function dropsTable(stmts, table) {
	return stmts.some((s) => DROP_TABLE.exec(s)?.[1] === table);
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
 * that needs both sides of the publish cannot be split and is refused instead. Without
 * `deferDrops` nothing runs after the publish, so a drop is refused rather than run early.
 *
 * @param {{ name: string, kind: 'contract' | 'expand' | 'mixed' }[]} pending
 * @param {{ deferDrops?: boolean }} [options]
 * @returns {{ when: 'none' | 'before' | 'after' } | { when: 'refuse', reason: string }}
 */
export function planMigrate(pending, { deferDrops = true } = {}) {
	if (pending.length === 0) return { when: 'none' };
	const mixed = pending.filter((m) => m.kind === 'mixed');
	const contract = pending.filter((m) => m.kind === 'contract');
	const expand = pending.filter((m) => m.kind === 'expand');
	if (!deferDrops && contract.length > 0 && mixed.length === 0) {
		return {
			when: 'refuse',
			reason:
				`${contract.map((m) => m.name).join(', ')} drops something, and ${AFTER_PUBLISH_FLAG} ` +
				`is unset, so nothing would run it after publish, and running it now breaks the ` +
				`Worker still serving. Set ${AFTER_PUBLISH_FLAG}=1 as a build variable and make the ` +
				`deploy command \`pnpm ci:migrate --before-publish && npx wrangler deploy && pnpm ` +
				`ci:migrate --after-publish\`.`
		};
	}
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
 * Run one read-only query against production over the D1 HTTP API.
 *
 * @param {{ accountId: string, databaseId: string, token: string }} creds
 * @param {string} sql
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function queryRemote(creds, sql, fetchImpl) {
	const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/d1/database/${creds.databaseId}/query`;
	const res = await fetchImpl(url, {
		method: 'POST',
		headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ sql })
	});
	const body = await res.json();
	if (!body.success) {
		throw new Error(`D1 query failed (${sql}): ${JSON.stringify(body.errors)}`);
	}
	return body.result[0]?.results ?? [];
}

/**
 * The migration names production has recorded, read over the D1 HTTP API.
 *
 * @param {{ accountId: string, databaseId: string, token: string }} creds
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[]>}
 */
export async function appliedMigrationNames(creds, fetchImpl = fetch) {
	const rows = await queryRemote(creds, 'SELECT name FROM __drizzle_migrations', fetchImpl);
	return rows.flatMap((r) => (typeof r.name === 'string' ? [r.name] : []));
}

/**
 * A table's columns in production, or undefined when production has no such table.
 *
 * @param {{ accountId: string, databaseId: string, token: string }} creds
 * @param {string} table
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[] | undefined>}
 */
export async function tableColumns(creds, table, fetchImpl = fetch) {
	if (!/^\w+$/.test(table)) throw new Error(`Not a table name: ${table}`);
	const rows = await queryRemote(creds, `PRAGMA table_info(\`${table}\`)`, fetchImpl);
	const names = rows.flatMap((r) => (typeof r.name === 'string' ? [r.name] : []));
	return names.length ? names : undefined;
}

/**
 * Applied names this build's `migrations/` lacks: production's schema is newer than this code.
 *
 * @param {string[]} local
 * @param {string[]} applied
 */
export function unknownApplied(local, applied) {
	const have = new Set(local);
	return applied.filter((name) => !have.has(name));
}

function localMigrations() {
	return readdirSync(MIGRATIONS, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/migration.sql`, MIGRATIONS)))
		.map((d) => d.name);
}

function remoteCreds() {
	return {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		databaseId: databaseId(),
		token: process.env.CLOUDFLARE_D1_TOKEN ?? ''
	};
}

function databaseId() {
	if (process.env.CLOUDFLARE_DATABASE_ID) return process.env.CLOUDFLARE_DATABASE_ID;
	const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
	const id = /^\s*database_id\s*=\s*["']([^"']+)["']/m.exec(toml)?.[1];
	if (!id) throw new Error('No database_id in wrangler.toml');
	return id;
}

/** @param {{ deferDrops: boolean }} options */
async function planFromRemote({ deferDrops }) {
	const local = localMigrations();
	const creds = remoteCreds();
	const applied = await appliedMigrationNames(creds);
	// Columns as production has them now, before any of the batch. A table an earlier pending
	// migration changes reads slightly off, but the batch is planned as one either way.
	const pending = [];
	for (const name of pendingMigrations(local, applied)) {
		const sql = readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8');
		/** @type {Map<string, string[]>} */
		const columns = new Map();
		for (const table of rebuiltTables(sql)) {
			const cols = await tableColumns(creds, table);
			if (cols) columns.set(table, cols);
		}
		pending.push({ name, kind: classifyMigration(sql, columns) });
	}
	for (const m of pending) console.log(`ci:migrate — pending ${m.name} (${m.kind})`);
	return planMigrate(pending, { deferDrops });
}

// A drop ships in a PR that changes nothing the app reads: the release already serving must have
// stopped using what it removes (#3411). Specs, seeds and docs cannot break a live Worker.
const SCHEMA_ONLY = [
	/^migrations\//,
	/^src\/lib\/server\/db\/schema\//,
	/^docs\//,
	/^scripts\/seed-dev\.ts$/,
	/^scripts\/seed\//,
	/^e2e\/fixtures\//,
	/\.spec\.ts$/
];

/**
 * What is wrong with a PR that adds a drop, one string each.
 *
 * @param {{
 *   added: { name: string, sql: string, columns?: Map<string, string[]> }[],
 *   changed: string[]
 * }} pr
 */
export function contractPrProblems({ added, changed }) {
	const kinds = added.map((m) => ({ name: m.name, kind: classifyMigration(m.sql, m.columns) }));
	const drops = kinds.filter((m) => m.kind !== 'expand');
	if (drops.length === 0) return [];
	const list = (/** @type {typeof kinds} */ ms) => ms.map((m) => m.name).join(', ');
	const problems = [];
	const mixed = kinds.filter((m) => m.kind === 'mixed');
	const expand = kinds.filter((m) => m.kind === 'expand');
	if (mixed.length > 0 || expand.length > 0) {
		const parts = [];
		if (mixed.length > 0) parts.push(`${list(mixed)} both adds and drops`);
		if (expand.length > 0) parts.push(`${list(drops)} drops beside ${list(expand)}, which adds`);
		problems.push(
			`${parts.join('; ')}. Ship the drop in a PR of its own, after the release that stops ` +
				`reading it has deployed.`
		);
	}
	const outside = changed.filter((f) => !SCHEMA_ONLY.some((re) => re.test(f)));
	if (outside.length > 0) {
		problems.push(
			`${list(drops)} drops something, and this PR also changes ${outside.join(', ')}. A drop PR ` +
				`may change only migrations, the schema, docs, seeds and specs: the release already ` +
				`serving must have stopped reading it.`
		);
	}
	return problems;
}

/** @param {string[]} args */
function git(args) {
	return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Each rebuilt table's columns before the PR, from the one snapshot at the merge base
// (prune-snapshots keeps the newest, and a PR's own migration replaces it).
/** @param {string} base @param {string} sql */
function baseColumns(base, sql) {
	/** @type {Map<string, string[]>} */
	const columns = new Map();
	const tables = rebuiltTables(sql);
	if (tables.length === 0) return columns;
	const path = git(['ls-tree', '-r', '--name-only', base, '--', 'migrations'])
		.split('\n')
		.find((f) => f.endsWith('/snapshot.json'));
	if (!path) return columns;
	const snap = readSnapshot(JSON.parse(git(['show', `${base}:${path}`])));
	for (const t of tables) {
		const cols = snap.columns.get(t);
		if (cols)
			columns.set(
				t,
				cols.map((c) => c.name)
			);
	}
	return columns;
}

function checkPr() {
	const base = git(['merge-base', process.env.BASE_REF ?? 'origin/main', 'HEAD']).trim();
	const diff = (/** @type {string[]} */ extra) =>
		git(['diff', '--name-only', ...extra, `${base}...HEAD`])
			.split('\n')
			.filter(Boolean);
	const added = diff(['--diff-filter=A', '--', 'migrations/*/migration.sql']).map((file) => {
		const sql = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
		return { name: file.split('/')[1], sql, columns: baseColumns(base, sql) };
	});
	const problems = contractPrProblems({ added, changed: diff([]) });
	for (const p of problems) console.error(`ci:migrate --check-pr — ${p}`);
	if (problems.length > 0) process.exit(1);
	console.log(
		`ci:migrate --check-pr — ${added.length} added migration(s), no drop shipped with code.`
	);
}

function migrate() {
	execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], { stdio: 'inherit' });
}

// Upserts src/content/help into production (#1698). It runs in the last step that touches the
// database, so its columns exist; a failure exits non-zero like a failed migrate, but after
// publish the new Worker is already live, so a red deploy step means only the help content lags.
function syncHelp() {
	console.log('ci:migrate — syncing help articles to remote D1…');
	execFileSync('pnpm', ['help:sync', '--remote'], { stdio: 'inherit' });
}

async function main() {
	// Workers Builds exposes the branch as WORKERS_CI_BRANCH; older Pages builds use CF_PAGES_BRANCH.
	const branch = process.env.WORKERS_CI_BRANCH ?? process.env.CF_PAGES_BRANCH ?? '';
	const afterPublish = process.argv.includes('--after-publish');

	if (process.argv.includes('--check-pr')) return checkPr();

	if (!isProductionBranch(branch)) {
		console.log(
			`ci:migrate — branch "${branch || '(unknown)'}" is neither "${PROD_BRANCH}" nor a "${PROD_QUEUE_PREFIX}*" merge queue branch, skipping remote migrate.`
		);
		return;
	}

	const kind = branch === PROD_BRANCH ? 'production branch' : 'production merge queue';
	if (process.argv.includes('--before-publish')) {
		const stale = unknownApplied(localMigrations(), await appliedMigrationNames(remoteCreds()));
		if (stale.length === 0) return console.log('ci:migrate — build is not older than the schema.');
		// Shows as a failed Workers Builds check on the queue SHA, which is not a required check.
		console.error(
			`ci:migrate — production already has ${stale.join(', ')}; a newer build owns production, not publishing.`
		);
		process.exit(1);
	}
	if (afterPublish) {
		// Whatever the build step left pending is contract-only by construction.
		console.log(`ci:migrate — applying deferred D1 migrations after publish (${kind})…`);
		migrate();
		return syncHelp();
	}

	const deferDrops = process.env[AFTER_PUBLISH_FLAG] === '1';
	if (!deferDrops) console.log(`ci:migrate — ${AFTER_PUBLISH_FLAG} unset, so a drop is refused.`);
	const plan = await planFromRemote({ deferDrops });
	if (plan.when === 'refuse') {
		console.error(`ci:migrate — refusing to deploy. ${plan.reason}`);
		process.exit(1);
	}
	if (!deferDrops) {
		if (plan.when === 'before') {
			console.log(`ci:migrate — applying D1 migrations to remote (${kind}, branch "${branch}")…`);
			migrate();
		}
		// No --after-publish step follows, so this is the last chance.
		return syncHelp();
	}
	if (plan.when === 'none') return console.log('ci:migrate — nothing pending.');
	if (plan.when === 'after') {
		return console.log('ci:migrate — contract-only batch, deferred to --after-publish.');
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
