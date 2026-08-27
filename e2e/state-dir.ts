/**
 * Where the e2e run keeps its emulated Cloudflare state.
 *
 * The suite used to share `.wrangler/state` with everything else on the machine
 * — `vite dev`, a stray `wrangler` command, a sibling worktree's server. That
 * directory is a set of SQLite files and workerd takes real locks on them, so a
 * second process touching one while the preview server holds it produced the
 * `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` failures that cost one random test per
 * run (CHORES.md). Its own directory takes everything that is not this suite
 * out of the picture.
 *
 * What stays inside the suite is handled by keeping the count of workerds over
 * this directory at one — the preview server. Seeds run from `e2e/prepare.ts`
 * before the server exists; mid-run read-backs go through `readLocalDb`, which
 * reads the same file without starting a runtime at all.
 *
 * The two exports are the same directory named the two ways its consumers want
 * it: `wrangler --persist-to` takes the root and appends `v3/` itself, while
 * `getPlatformProxy({ persist: { path } })` — and the adapter's `platformProxy`
 * option, which is how the preview server gets here — takes that `v3` directory
 * directly. Passing the wrong one to either is silent: nothing errors, the seed
 * simply lands in a database the server never opens.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewPort } from '../scripts/lib/checkout-ports';
import { d1File } from '../scripts/lib/d1-file';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The port this checkout's preview server binds.
 *
 * Re-exported here so the specs that need to build an absolute URL — the
 * subdomain ones, which cannot use Playwright's relative `baseURL` — take the
 * port from the same place `playwright.config.ts` and `vite.config.ts` do,
 * rather than each restating a literal that then has to be kept in step.
 */
export const E2E_PREVIEW_PORT = previewPort(REPO_ROOT);

/** Root of the run's state, as `wrangler --persist-to` wants it. */
export const E2E_STATE_ROOT = join(REPO_ROOT, '.wrangler', 'e2e-state');

/** The same state, as `getPlatformProxy`/`platformProxy` want it. */
export const E2E_PERSIST_PATH = join(E2E_STATE_ROOT, 'v3');

/**
 * The SQLite file behind the local D1 `DB` binding, for this run's state.
 *
 * The discovery itself lives in `scripts/lib/d1-file.ts`, because
 * `db:migrate:local` needs the same derivation against whichever state
 * directory it was pointed at.
 */
export function e2eD1File(): string {
	return d1File(E2E_PERSIST_PATH);
}
