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
	webServer: {
		// `pnpm`, not `npm`: this repo is pnpm-only and a global prettier 2.8.8
		// shadows its prettier 3, which is why `npm`/`npx` are blocked everywhere
		// else.
		command: 'pnpm build && pnpm preview',
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
