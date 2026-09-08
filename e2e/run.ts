/**
 * Run Playwright, abort if its preview server dies, then hand the database back
 * the way we found it.
 *
 * This wrapper exists for two reasons.
 *
 * The cleanup has to happen once the preview server is gone. Playwright's
 * `globalTeardown` runs *before* its plugins are torn down, and `webServer` is
 * a plugin — a write from there would contend with the server for the same
 * SQLite files, which is exactly the overlap `e2e/prepare.ts` was split out to
 * avoid. So the reset runs here, after `playwright test` has exited and taken
 * its server with it, mirroring the way `prepare.ts` seeds before Playwright
 * starts.
 *
 * And nothing inside Playwright watches the web server once it has started:
 * `WebServerPlugin` races the process's exit only while waiting for the port,
 * and drops it afterwards. A workerd that dies on its first *request* — the
 * SQLITE_BUSY_RECOVERY race, #793 — therefore goes unreported, and the suite
 * runs every remaining test against a closed port: 250 failures across 39 spec
 * files, none of them an assertion. `e2e/supervise.ts` watches the output this
 * process is forwarding and stops the run on the first sign of it.
 *
 * A failing run keeps its state. The database after a red run is the most
 * useful thing in the directory — it is what the app actually wrote — and the
 * next run clears it before seeding anyway, so nothing accumulates.
 *
 * The next run also rebuilds the directory outright if the migration list has
 * moved on in a way the kept state cannot be migrated into — see
 * `journalDisagreesWithSchema` in `e2e/reset-db.ts`. Keeping a red run's state
 * therefore never costs the run after it.
 */
import { forwardedArgs } from '../scripts/lib/forwarded-args';
import { acquireE2eLock, releaseE2eLock, releaseE2eLockOnExit } from './lock';
import { resetE2eDatabase } from './reset-db';
import { E2E_PREVIEW_PORT } from './state-dir';
import { supervise } from './supervise';

// Adopt the lock `e2e/prepare.ts` took: it exited when its seeding finished, so
// the run this wrapper is about to start has to carry it the rest of the way.
acquireE2eLock('run');
releaseE2eLockOnExit();

/**
 * This run's flags, forwarded to `playwright test`.
 *
 * `pnpm test:e2e:run -- --shard=1/2` is the documented spelling, and pnpm
 * forwards the `--` itself; `playwright test` reads a bare `--` as a filename
 * filter that matches nothing and reports "No tests found", so a CI shard that
 * silently ran nothing would pass. `scripts/lib/forwarded-args.ts` drops it, for
 * `pnpm test:unit` as well.
 */
const args = forwardedArgs();

const { status, crash } = await supervise('pnpm', ['exec', 'playwright', 'test', ...args], {
	port: E2E_PREVIEW_PORT
});

if (status === 0) {
	try {
		resetE2eDatabase();
	} catch (err) {
		// Never turn a green suite red over cleanup. Locally
		// `reuseExistingServer` can leave a preview this run did not start still
		// holding the file; the next run's reset clears it either way.
		console.warn('\nCould not clear the e2e database — the next run will clear it before seeding.');
		console.warn(err);
	}
} else {
	if (crash) {
		console.log(
			'\nThis run was aborted because the e2e web server died — see the report above.' +
				'\nNo assertion failed; whatever ran had nothing to talk to.'
		);
	}
	console.log(
		'\nLeaving .wrangler/e2e-state intact so the failing run can be inspected.' +
			'\nClear it with `pnpm tsx e2e/reset-db.ts` — which empties the tables, and' +
			"\ndrops the directory outright when its schema and drizzle's migration" +
			'\njournal disagree (emptying rows cannot fix that; `rm -rf .wrangler/e2e-state`' +
			'\nis the same thing by hand). `e2e/prepare.ts` detects that case too, so the' +
			'\nnext run recovers on its own either way.'
	);
}

releaseE2eLock();
process.exit(status);
