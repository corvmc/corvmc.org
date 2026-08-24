/**
 * Prepare the run's local D1 — migrate and seed — *before* Playwright starts
 * the preview server.
 *
 * This has to happen before the server boots, not from `globalSetup`. Playwright
 * orders its startup tasks as [remove output dirs, plugin setup, global setup],
 * and `webServer` is a plugin, so `globalSetup` only runs once the preview server
 * is already up and serving. Migrating and seeding from there meant a second
 * miniflare (every `wrangler d1 execute` in the migrate loop, then each fixture's
 * `getPlatformProxy()`) opening the state directory while the server held it.
 *
 * SQLite tolerates that right up until the file needs recovery, at which point
 * the exclusive lock can't be taken and workerd dies outright:
 *
 *   *** Fatal uncaught kj::Exception: SENTRY_DO SQLite failed;
 *       database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_RECOVERY)
 *   MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
 *
 * — which fails the whole suite, not one test. Running here means every one of
 * those processes has exited before the server opens the file.
 *
 * The database itself lives in the run's own state directory (`e2e/state-dir.ts`),
 * not the `.wrangler/state` that `pnpm dev` and every other wrangler command use,
 * so nothing outside this suite is ever holding it.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_STATE_ROOT, REPO_ROOT } from './state-dir';
import { acquireE2eLock } from './lock';
import { resetE2eDatabase } from './reset-db';
import { seedPayReservation } from './fixtures/seed-pay-reservation';
import { seedBandOnboarding } from './fixtures/seed-band-onboarding';
import { seedStaffUser } from './fixtures/seed-staff-user';
import { seedStaffEvent } from './fixtures/seed-staff-event';
import { seedReservationPayments } from './fixtures/seed-reservation-payments';
import { seedVolunteering } from './fixtures/seed-volunteering';
import { seedFeatureFlags } from './fixtures/seed-feature-flags';
import { seedCommunityEvents } from './fixtures/seed-community-events';
import { seedSuggestions } from './fixtures/seed-suggestions';
import { seedMessaging } from './fixtures/seed-messaging';
import { seedInboxAwaiting } from './fixtures/seed-inbox-awaiting';

const MIGRATIONS_DIR = join(REPO_ROOT, 'migrations');
const STAMP = join(E2E_STATE_ROOT, 'applied-migrations');

/** The migrations `pnpm db:migrate:local` would apply, in the order it applies them. */
function migrationNames(): string {
	return readdirSync(MIGRATIONS_DIR)
		.filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
		.sort()
		.join('\n');
}

/**
 * Build the run's database from the migrations whenever it doesn't match them.
 *
 * The migration SQL is plain `CREATE TABLE`, so it can only be applied to an
 * empty database — a new migration means starting over rather than topping up.
 * Cheap: CI always starts from nothing, and locally this only runs the first
 * time and after `pnpm db:generate`. Rebuilding drops KV and R2 along with D1,
 * which is what we want — the seeds are idempotent, but KV counters (the
 * report rate limit) are not.
 */
function migrateIfStale(): void {
	const wanted = migrationNames();
	const applied = existsSync(STAMP) ? readFileSync(STAMP, 'utf8') : null;
	if (applied === wanted) return;

	rmSync(E2E_STATE_ROOT, { recursive: true, force: true });
	execSync('pnpm db:migrate:local', {
		stdio: 'inherit',
		cwd: REPO_ROOT,
		env: { ...process.env, WRANGLER_PERSIST_TO: E2E_STATE_ROOT }
	});
	mkdirSync(E2E_STATE_ROOT, { recursive: true });
	writeFileSync(STAMP, wanted);
}

// Before the build, the seed, and the five minutes they cost: refuse outright if
// another suite is already running on this machine. Two of them no longer share
// ports or state, but they do share the CPU, and that is enough to redden a
// whole spec file at a time in both runs.
acquireE2eLock('prepare');

// Deliberately *not* released when this process exits. `pnpm test:e2e` is
// `prepare.ts && run.ts` — two processes — and the lock has to bridge them, or
// the gap between the seed finishing and Playwright starting is a hole another
// suite walks straight into. `run.ts` adopts it and owns releasing it. If this
// process dies instead, the lock is left with a dead pid and `lock.ts` ages it
// out as stale.

migrateIfStale();

// Start from an empty database, not a nearly-empty one. Each fixture clears
// its own rows, but nothing owns the `session` rows every login writes, the
// `notification` rows the app writes as a side effect, or whatever a UI test
// left in a table its fixture does not sweep. `e2e/run.ts` already cleared
// after a green run; this covers a crash, or a red run kept for inspection.
resetE2eDatabase();

await seedPayReservation();
await seedBandOnboarding();
await seedStaffUser();
await seedStaffEvent();
await seedReservationPayments();
await seedVolunteering();
await seedCommunityEvents();
// After the staff fixture: one seeded vote belongs to the staff user.
await seedSuggestions();
await seedMessaging();
await seedInboxAwaiting();
await seedFeatureFlags();
