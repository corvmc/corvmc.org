/**
 * Run Playwright, then hand the database back the way we found it.
 *
 * This wrapper exists for one reason: the cleanup has to happen once the
 * preview server is gone. Playwright's `globalTeardown` runs *before* its
 * plugins are torn down, and `webServer` is a plugin — a write from there would
 * contend with the server for the same SQLite files, which is exactly the
 * overlap `e2e/prepare.ts` was split out to avoid. So the reset runs here,
 * after `playwright test` has exited and taken its server with it, mirroring the
 * way `prepare.ts` seeds before Playwright starts.
 *
 * A failing run keeps its state. The database after a red run is the most
 * useful thing in the directory — it is what the app actually wrote — and the
 * next run clears it before seeding anyway, so nothing accumulates.
 */
import { spawnSync } from 'node:child_process';
import { acquireE2eLock, releaseE2eLock, releaseE2eLockOnExit } from './lock';
import { resetE2eDatabase } from './reset-db';

// Adopt the lock `e2e/prepare.ts` took: it exited when its seeding finished, so
// the run this wrapper is about to start has to carry it the rest of the way.
acquireE2eLock('run');
releaseE2eLockOnExit();

/**
 * This run's flags, forwarded to `playwright test`.
 *
 * `pnpm test:e2e:run -- --shard=1/2` is the documented way to pass a flag through
 * a pnpm script, but pnpm forwards the `--` itself rather than eating it, and
 * `playwright test` reads a bare `--` as a filename filter that matches nothing:
 *
 *   Error: No tests found. Make sure that arguments are regular expressions
 *   matching test files.
 *
 * which is a *green*-looking failure — the suite reports "no tests" rather than a
 * red test, so a CI shard that silently ran nothing would only be caught by
 * reading the log. Drop the separator so both spellings behave the same.
 */
const args = process.argv.slice(2).filter((arg) => arg !== '--');

const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...args], {
	stdio: 'inherit'
});

if (result.error) {
	console.error(result.error);
	process.exit(1);
}

// A signal (Ctrl-C) leaves `status` null; treat it as a failure and keep state.
const status = result.status ?? 1;

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
	console.log(
		'\nLeaving .wrangler/e2e-state intact so the failing run can be inspected.' +
			'\nClear it with `pnpm tsx e2e/reset-db.ts`.'
	);
}

releaseE2eLock();
process.exit(status);
