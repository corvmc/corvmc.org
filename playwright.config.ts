import { defineConfig } from '@playwright/test';
import { E2E_PERSIST_PATH, REPO_ROOT } from './e2e/state-dir';
import { previewPort } from './scripts/lib/checkout-ports';

/**
 * The port this checkout's preview server binds, and therefore the one the suite
 * talks to. The main checkout keeps 4173; a worktree gets its own, so a sibling
 * worktree's server can never be adopted through `reuseExistingServer` below.
 * `vite.config.ts` binds the same number with `strictPort`.
 */
const PORT = previewPort(REPO_ROOT);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	// Seed the local D1 (member + payable reservation) before any test runs.
	globalSetup: './e2e/global-setup.ts',
	// CI runs the suite in parallel against one preview server holding one set of
	// SQLite files, on a runner with a fraction of a laptop's cores. The heavy
	// specs — a band booking a session is ~50s alone — then miss their own
	// assertion windows: on 2026-08-21 four consecutive runs of #242 went red, a
	// different test each time, every one of them passing locally in isolation.
	// With `retries: 0` that reddens a required check, and a red required check
	// disarms auto-merge, so the PR sits open with nothing watching it. A retried
	// test is reported as "flaky" rather than passing quietly, so this buys the
	// queue tolerance without hiding a test that has started to fail for real —
	// watch the flaky count, and fix the spec when one stops being occasional.
	//
	// Know what this does *not* buy. The suite shares one database, seeded once
	// by `e2e/prepare.ts` before Playwright starts, and most specs mutate the
	// fixture they assert on. A test that fails *after* its mutation lands has
	// already spent the row it needs, so its retry starts from data the fixture
	// never described and fails differently — "element(s) not found" for a row
	// attempt 0 approved. Retries rescue a test that fails *before* it writes
	// (a slow page, a missed assertion window); they cannot rescue one that
	// fails after, and one such failure fails the job whatever `retries` says.
	//
	// Per-test seeding would make those retries mean something, and is not
	// available here: a mid-run write is a second writer on the SQLite files the
	// preview server holds, which is the `SQLITE_BUSY` failure the whole
	// prepare/run split exists to avoid — `e2e/fixtures/platform-db.ts` opens
	// read-only for exactly this reason. So the rule for a mutating spec is that
	// it has to be right the first time: assert against the database through
	// `expect.poll`, never a bare read (`e2e/volunteering.e2e.ts` has the note),
	// and treat a red mutating test as real rather than waiting on a retry.
	retries: process.env.CI ? 2 : 0,
	/**
	 * How long an assertion waits — 15s, not Playwright's 5s.
	 *
	 * The suite already disagreed with the default, one assertion at a time: 110
	 * of them carry a hand-written `{ timeout: 15000 }`. The other 295 carry
	 * nothing and so ran at 5s, which is the same budget whether the runner is a
	 * laptop or a CI box serving one preview server to a parallel suite. That
	 * mismatch is what the note above `retries` describes without naming — "four
	 * consecutive runs of #242 went red, a different test each time, every one of
	 * them passing locally in isolation". A different test each time, only under
	 * contention, is an assertion budget that ran out, not a logic bug.
	 *
	 * For scale: the slowest single test in a local run is ~6.4s end to end, so
	 * an unmarked assertion inside it had less budget than the test's own
	 * runtime, on hardware several times faster than the runner.
	 *
	 * The explicit `{ timeout: 15000 }` call sites are now redundant rather than
	 * wrong. Leave them where they are; they document which assertions their
	 * author knew were slow, and rewriting 110 of them would bury that.
	 */
	expect: { timeout: 15_000 },
	/**
	 * And the per-test budget, raised with it.
	 *
	 * These two have to move together. Assertions only spend their timeout when
	 * they *fail*, so raising `expect` alone costs a passing run nothing — but it
	 * lets two failing assertions exhaust Playwright's 30s default between them,
	 * and the report then says "Test timeout of 30000ms exceeded" instead of
	 * naming the assertion and showing its diff. That trades a slow honest
	 * failure for a fast useless one.
	 */
	timeout: 60_000,
	/**
	 * What a failure leaves behind.
	 *
	 * Playwright already writes an `error-context.md` per failure and the log
	 * names its path, but the CI job uploaded nothing, so every path it named led
	 * nowhere and triage of a red E2E was guesswork against a green laptop. A
	 * hydration race that reproduces only on a runner is exactly the failure that
	 * cannot be diagnosed any other way.
	 *
	 * `on-first-retry`, not `on`: a trace records the whole run, and this suite is
	 * already CPU-bound on a runner with a fraction of a laptop's cores. Recording
	 * one for every passing test would slow every green run to pay for the rare
	 * red one. On the first retry it costs nothing until something has already
	 * failed — and since `retries: 2`, a genuine failure always produces one.
	 * Screenshots are cheap enough to keep unconditional on failure.
	 */
	use: {
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	webServer: {
		// `pnpm`, not `npm`: this repo is pnpm-only and a global prettier 2.8.8
		// shadows its prettier 3, which is why `npm`/`npx` are blocked everywhere
		// else.
		// The checkpoint between the two halves is load-bearing, not tidiness.
		// `prepare.ts` checkpoints after seeding, but the *build* runs after that
		// and leaves a WAL of its own — `adapter-cloudflare`'s `emulate()` calls
		// `getPlatformProxy`, which opens this same D1 file and never disposes it.
		// workerd then opens D1 lazily on the first request, races Playwright's
		// readers trying to recover that WAL, and dies with SQLITE_BUSY_RECOVERY,
		// taking the whole suite rather than one test. See e2e/checkpoint.ts.
		command: 'pnpm build && pnpm exec tsx e2e/checkpoint.ts && pnpm preview',
		port: PORT,
		// The command builds before it serves, and a cold production build here
		// takes several minutes — well past the 60s default, which reported the
		// timeout as a server failure rather than a slow build.
		timeout: 600_000,
		// Reuse a preview already running locally to avoid a full rebuild each run.
		reuseExistingServer: !process.env.CI,
		env: {
			// The run's own miniflare state, seeded by e2e/prepare.ts. Read by
			// svelte.config.js, which hands it to the adapter's platform emulation —
			// without it the preview server would open `.wrangler/state`, which
			// `pnpm dev` and every wrangler command also use, and a second process
			// on those SQLite files is what cost the suite a random test per run.
			MINIFLARE_PERSIST_PATH: E2E_PERSIST_PATH,
			SENTRY_ENVIRONMENT: 'ci',
			PUBLIC_SENTRY_ENVIRONMENT: 'ci',
			// $env/dynamic/private reads process.env under `vite preview`, so the
			// secrets that .dev.vars provides to the seed must also be passed here or
			// the preview server throws ("ORIGIN environment variable is required").
			// Real values can override these via the shell environment.
			ORIGIN: process.env.ORIGIN ?? BASE_URL,
			// Band addresses hang off this domain, so the subdomain tests need it to
			// be `localhost` — without it the app falls back to corvmc.org and
			// {slug}.localhost:<port> is not recognised as a band address at all.
			PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL ?? BASE_URL,
			BETTER_AUTH_SECRET:
				process.env.BETTER_AUTH_SECRET ?? 'e2e-local-better-auth-secret-not-for-prod',
			STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy_e2e',
			STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_dummy_e2e'
		}
	},
	testMatch: '**/*.e2e.{ts,js}'
});
