/**
 * Apply the committed migrations to a local (miniflare) D1.
 *
 * This used to be a shell loop running one `wrangler d1 execute --file` per
 * migration. That shape came from `27ff813`, which consolidated the schema into
 * a *single* initial migration and switched to "wrangler d1 execute (compatible
 * with drizzle-kit's directory format)" — at the time it was a loop of one. At
 * 38 migrations it was 38 CLI starts and 38 miniflare boots to apply 175KB of
 * SQL, and cost 64s of every CI e2e run.
 *
 * `wrangler d1 migrations apply` cannot replace it, and cannot be configured to:
 * wrangler discovers migrations with `opendirSync` + `endsWith('.sql')` and does
 * not recurse, while drizzle-kit 1.0 emits `<timestamp>_<name>/migration.sql`
 * and has no option to emit anything else (its `migrations` config takes only
 * `table` and `schema`). `migrations_dir` relocates the folder; it does not
 * change what counts as a migration.
 *
 * So use drizzle's own migrator, which reads drizzle's own layout. It also
 * records what it applied in `__drizzle_migrations`, the same table
 * `drizzle-kit migrate` uses against remote D1, which makes this incremental
 * rather than a full replay that errors on a non-empty database.
 *
 * One property matters and is deliberate: the migrator wraps everything in a
 * single `BEGIN`/`COMMIT`, which makes `PRAGMA foreign_keys` inert. That is
 * exactly how D1 runs migrations in production, and it is the constraint
 * `scripts/db/d1-safe-rebuild.mjs` rewrites table rebuilds to satisfy — so this
 * matches production semantics rather than diverging from them.
 *
 * Remote is untouched: `pnpm ci:migrate` / `pnpm db:migrate` still go through
 * `drizzle-kit migrate`.
 */
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { d1File, hasD1File } from '../lib/d1-file';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_FOLDER = join(REPO_ROOT, 'migrations');

/** The state root, as `wrangler --persist-to` takes it. */
export function persistRoot(env: NodeJS.ProcessEnv = process.env): string {
	return resolve(REPO_ROOT, env.WRANGLER_PERSIST_TO || join('.wrangler', 'state'));
}

/**
 * Make miniflare create its D1 layout, so there is a file to migrate.
 *
 * Only needed the first time a state directory is used. The filename is a hash
 * miniflare derives itself, so it has to be created by miniflare rather than
 * guessed — this is the same `getPlatformProxy` call `e2e/fixtures/platform-db.ts`
 * uses, and like every other seed-time miniflare it must not overlap a running
 * preview server.
 */
async function createD1File(persistPath: string): Promise<void> {
	const { getPlatformProxy } = await import('wrangler');
	const proxy = await getPlatformProxy({ persist: { path: persistPath } });
	try {
		await (proxy.env as { DB: D1Database }).DB.prepare('SELECT 1').all();
	} finally {
		await proxy.dispose().catch(() => {});
	}
}

/**
 * Apply every unapplied migration to the SQLite file at `file`.
 *
 * Split out from `migrateLocal` so it can be exercised against a scratch file:
 * everything below this line is drizzle and `node:sqlite`, with no miniflare in
 * it, which is what makes `migrate-local.spec.ts` fast and deterministic.
 */
export function applyMigrations(file: string): void {
	const client = new DatabaseSync(file, { timeout: 5_000 });
	try {
		migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
	} finally {
		client.close();
	}
}

/** Apply every unapplied migration to the local D1 under `root`. */
export async function migrateLocal(root: string = persistRoot()): Promise<string> {
	const persistPath = join(root, 'v3');
	if (!hasD1File(persistPath)) await createD1File(persistPath);

	const file = d1File(persistPath);
	applyMigrations(file);
	return file;
}

// `tsx scripts/db/migrate-local.ts` — what `pnpm db:migrate:local` runs. Not a
// top-level await: this module is also imported (by `e2e/prepare.ts`), and a
// top-level await makes it ESM-only, which fails under any CJS-transpiling
// caller with an error about the transform rather than about this file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	migrateLocal().then(
		(file) => console.log(`Migrated ${file}`),
		(err) => {
			console.error(err);
			process.exit(1);
		}
	);
}
