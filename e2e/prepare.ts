/**
 * Prepare the run's local D1 — migrate and seed — *before* Playwright starts
 * the preview server.
 *
 * This has to happen before the server boots, not from `globalSetup`. Playwright
 * orders its startup tasks as [remove output dirs, plugin setup, global setup],
 * and `webServer` is a plugin, so `globalSetup` only runs once the preview server
 * is already up and serving. Migrating and seeding from there meant a second
 * miniflare (the migrate's own, then each fixture's `getPlatformProxy()`)
 * opening the state directory while the server held it.
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
 *
 * The migrate is incremental — `scripts/db/migrate-local.ts` goes through
 * drizzle's migrator, which records what it applied in `__drizzle_migrations` —
 * so this runs it unconditionally and it costs one `SELECT` when the database is
 * already current. To start from nothing (a corrupt state directory, or KV
 * counters a fixture does not own), delete the directory: `rm -rf .wrangler/e2e-state`.
 * The one case that used to *require* that by hand — a schema the journal does
 * not account for — is now detected and rebuilt below.
 */
import { E2E_STATE_ROOT } from './state-dir';
import { migrateLocal } from '../scripts/db/migrate-local';
import { acquireE2eLock } from './lock';
import {
	checkpointE2eDatabase,
	checkpointSummary,
	clearE2eStateDir,
	e2eStateIsStale,
	resetE2eDatabase
} from './reset-db';
import { seedPayReservation } from './fixtures/seed-pay-reservation';
import { seedMembershipBilling } from './fixtures/seed-membership-billing';
import { seedBandOnboarding } from './fixtures/seed-band-onboarding';
import { seedBandAudio } from './fixtures/seed-band-audio';
import { seedStaffUser } from './fixtures/seed-staff-user';
import { seedInventory } from './fixtures/seed-inventory';
import { seedStaffEvent } from './fixtures/seed-staff-event';
import { seedTicketPurchase } from './fixtures/seed-ticket-purchase';
import { seedReservationPayments } from './fixtures/seed-reservation-payments';
import { seedVolunteering } from './fixtures/seed-volunteering';
import { seedFeatureFlags } from './fixtures/seed-feature-flags';
import { seedGroups } from './fixtures/seed-groups';
import { seedCommunityEvents } from './fixtures/seed-community-events';
import { seedEventsSplit } from './fixtures/seed-events-split';
import { seedSuggestions } from './fixtures/seed-suggestions';
import { seedMessaging } from './fixtures/seed-messaging';
import { seedInboxAwaiting } from './fixtures/seed-inbox-awaiting';
import { seedDirectoryEntries } from './fixtures/seed-directory-entries';
import { seedInstructors } from './fixtures/seed-instructors';
import { seedContractors } from './fixtures/seed-contractors';

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

// A directory whose schema and drizzle's journal disagree cannot be migrated
// into at all: the migrator replays from migration 1 and dies on a `CREATE
// TABLE` for a table that is already there, and the rollback leaves the same
// directory behind for the next attempt. Rebuild rather than fail — the run was
// going to reset and reseed everything below anyway, so nothing is lost but the
// migrate itself. See `journalDisagreesWithSchema` in `e2e/reset-db.ts`.
if (e2eStateIsStale()) {
	console.warn(
		"The e2e state directory has tables that drizzle's migration journal does not" +
			'\naccount for. Rebuilding .wrangler/e2e-state from the committed migrations.'
	);
	clearE2eStateDir();
}

await migrateLocal(E2E_STATE_ROOT);

// Start from an empty database, not a nearly-empty one. Each fixture clears
// its own rows, but nothing owns the `session` rows every login writes, the
// `notification` rows the app writes as a side effect, or whatever a UI test
// left in a table its fixture does not sweep. `e2e/run.ts` already cleared
// after a green run; this covers a crash, or a red run kept for inspection.
resetE2eDatabase();

await seedPayReservation();
await seedMembershipBilling();
await seedBandOnboarding();
// After the bands: its releases hang off the public band's id.
await seedBandAudio();
await seedStaffUser();
await seedInventory();
// After the inventory fixture: it reuses that fixture's category, and seeds
// its own item and unit so the two suites never mutate the same asset.
await seedContractors();
await seedStaffEvent();
// After the staff fixture: the show is created by the staff user.
await seedTicketPurchase();
await seedReservationPayments();
await seedVolunteering();
await seedCommunityEvents();
// Its own rows, because `community-events.e2e.ts` mutates the ones it seeds.
await seedEventsSplit();
// After the staff fixture: one seeded vote belongs to the staff user.
await seedSuggestions();
await seedMessaging();
await seedInboxAwaiting();
// After the staff fixture: both programs are led by the staff user, and the
// committee's applicant is its role target.
await seedGroups();
await seedFeatureFlags();
// Before the sweep, not after. It writes its own `directory_entry` rows — one
// public, one members-only — and the sweep only claims users that have none, as
// its own note says: "a fixture that needs a public member sets its own entry".
//
// Position matters beyond correctness. `checkpointE2eDatabase()` below has to run
// once every seed's miniflare has exited, and each `withPlatformEnv` call is one
// more workerd start and dispose. Slotting a new one in as the *last* writer
// narrowed that window and the preview server then failed to start outright —
// `SENTRY_DO SQLite failed; database is locked: SQLITE_BUSY_RECOVERY`, taking
// every test in the suite with it. Keeping the directory sweep last leaves the
// ordering exactly as it is on main.
await seedInstructors();

// Last of the data fixtures: sweeps every user and group the ones above created
// into `directory_entry`, which is what the directory reads.
await seedDirectoryEntries();

// Last, once every seed's miniflare has exited: leave no file with a WAL for the
// preview server to recover. workerd opens its SQLite on the first *request*, by
// which time Playwright's workers are already reading, and a recovery that
// collides with those readers kills the server outright. Reported rather than
// assumed — a checkpoint that could not take the lock says so. See `reset-db.ts`.
console.log(checkpointSummary(checkpointE2eDatabase()));
