/**
 * Two ways for the e2e suite to reach its local D1, and the rule for choosing.
 *
 * The state directory (`e2e/state-dir.ts`) is a set of SQLite files that
 * workerd locks as it works. Exactly one workerd may hold them: a second one
 * opening the same database while the preview server is serving is what raised
 * `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` inside the *server*, which D1 then
 * reported as an opaque "internal error" and which timed out whichever test
 * happened to be mid-flight.
 *
 * So:
 *
 * - `withPlatformEnv` / `withPlatformDb` start a miniflare and hand back the
 *   real bindings, KV and R2 included. They are for **seeding only**, from
 *   `e2e/prepare.ts`, which runs to completion before Playwright starts the
 *   preview server. Never call them from a test.
 * - `readLocalDb` opens the D1 file itself through `node:sqlite`, read-only,
 *   with no runtime in between. That is what a test's read-back wants: the file
 *   is in WAL mode, where a reader neither blocks the writer nor is blocked by
 *   it, and it sees every row the server has committed. It is also two orders
 *   of magnitude cheaper than booting a workerd per read.
 */
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { getPlatformProxy } from 'wrangler';
import { drizzle } from 'drizzle-orm/d1';
import { drizzle as drizzleLocal } from 'drizzle-orm/node-sqlite';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { E2E_PERSIST_PATH, e2eD1File } from '../state-dir';

/** Transient lock contention, as opposed to a genuine query or schema error. */
function isLockContention(err: unknown): boolean {
	// D1 flattens the underlying SQLite failure into a message, and the useful
	// text is often only on a nested `cause`, so walk the chain.
	for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
		const message = e instanceof Error ? `${e.message}` : String(e);
		if (/SQLITE_BUSY|database is locked|Failed to parse body as JSON|internal error/i.test(message))
			return true;
		e = e instanceof Error ? (e.cause ?? null) : null;
	}
	return false;
}

const MAX_ATTEMPTS = 5;

/** Retry transient lock contention with a widening backoff. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (!isLockContention(err) || attempt === MAX_ATTEMPTS) throw err;
			await new Promise((r) => setTimeout(r, attempt * 250));
		}
	}

	throw lastError;
}

/**
 * Run `fn` against the run's bindings through a miniflare of our own.
 *
 * Seeding only — see the note at the top of this file. Every call starts and
 * disposes a workerd, so it must not overlap the preview server's.
 */
export function withPlatformEnv<T>(
	fn: (ctx: { db: DrizzleD1Database; env: Record<string, unknown> }) => Promise<T>
): Promise<T> {
	return withRetry(async () => {
		// A fresh proxy per attempt — the lock can be taken during
		// `getPlatformProxy()` itself, not only by the query.
		const proxy = await getPlatformProxy({ persist: { path: E2E_PERSIST_PATH } });
		try {
			const env = proxy.env as Record<string, unknown>;
			return await fn({ db: drizzle((env as { DB: D1Database }).DB), env });
		} finally {
			// Always hand the state directory back, including on a failing attempt
			// — a leaked proxy would keep the lock the retry is waiting on.
			await proxy.dispose().catch(() => {});
		}
	});
}

/** `withPlatformEnv` for the common case of only needing the database. */
export function withPlatformDb<T>(fn: (db: DrizzleD1Database) => Promise<T>): Promise<T> {
	return withPlatformEnv(({ db }) => fn(db));
}

/**
 * Read the run's D1 while the preview server is serving from it.
 *
 * Read-only on purpose: a write from here would contend with the server for the
 * same file, which is the whole problem this indirection exists to avoid. Tests
 * change data by driving the app.
 */
export function readLocalDb<T>(fn: (db: NodeSQLiteDatabase) => Promise<T> | T): Promise<T> {
	return withRetry(async () => {
		const client = new DatabaseSync(e2eD1File(), { readOnly: true, timeout: 5_000 });
		try {
			return await fn(drizzleLocal({ client }));
		} finally {
			client.close();
		}
	});
}
