/**
 * Fold the write-ahead log back into the database, between the build and the
 * preview server.
 *
 * `e2e/prepare.ts` already checkpoints after seeding, and that covers the WAL
 * the *seeds* leave. It does not cover the one the **build** leaves, and the
 * build runs afterwards: Playwright's `webServer.command` is
 * `pnpm build && pnpm preview`, and `@sveltejs/adapter-cloudflare`'s `emulate()`
 * hook calls `getPlatformProxy` during the build, which opens the same D1 file,
 * writes a fresh WAL, and never disposes it.
 *
 * So by the time `pnpm preview` starts, the file has a WAL again — and workerd
 * opens D1 *lazily, on the first request*, by which point Playwright has started
 * its workers and each holds a `readLocalDb` reader. Recovery needs an exclusive
 * lock, the readers deny it, and workerd does not retry. It dies, taking the
 * whole suite with it rather than one test:
 *
 *   *** Fatal uncaught kj::Exception: SENTRY_DO SQLite failed;
 *       database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_RECOVERY)
 *   MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
 *
 * Observed ejecting PRs from the merge queue five times across #328, #338 and
 * #354 — every one a whole-suite failure on a server that never came up, which
 * reads as "the diff broke everything" rather than as one race.
 *
 * Running this between the two halves of that command leaves nothing for workerd
 * to recover. It is a no-op when there is no database, so it cannot fail a run
 * that had nothing to checkpoint.
 */
import { checkpointE2eDatabase, checkpointSummary } from './reset-db';

// stderr, not stdout. Playwright forwards a webServer's stderr and ignores its
// stdout, so a `console.log` here is invisible in exactly the CI logs somebody
// reads when the suite has died on a server that never started — which is the
// failure this step exists to prevent, and the one where knowing it ran matters.
//
// The summary names any file whose WAL survived rather than reporting a flat
// success. `PRAGMA wal_checkpoint(TRUNCATE)` answers `busy: 1` instead of throwing
// when it cannot take the lock, so "it ran" and "it worked" are different facts,
// and only the second one predicts a server that will come up.
console.error(checkpointSummary(checkpointE2eDatabase()));
