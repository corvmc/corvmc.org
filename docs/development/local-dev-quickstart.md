# Local Development Quickstart

Zero to a running app with realistic seed data. Nothing here touches production — the
local database is a SQLite file under `.wrangler/state/`, and every external integration
degrades gracefully or has a test mode.

## Prerequisites

- **Node 22** (CI runs 22; `@types/node` targets it)
- **pnpm 9.15.x** — the repo pins `"packageManager": "pnpm@9.15.9"` and `.npmrc` sets
  `engine-strict=true`, so a mismatched manager fails loudly. `corepack enable` is the
  easiest way to get the right one.
- No Cloudflare account or `wrangler login` needed for pure-local work — wrangler runs in
  local mode.

## 1. Install

```bash
pnpm install
```

The `prepare` script runs automatically and does three things: `svelte-kit sync`
(generates `.svelte-kit/` types), compiles the MJML email layout
(`scripts/compile-email-layouts.ts` → `src/lib/server/generated/`), and installs the
**lefthook** git hooks (auto-format on commit, type-check heads-up on push — see
[conventions](conventions.md#git-hooks)).

## 2. Environment

```bash
cp .env.example .env
```

`.env` is read by the Vite dev server (for `$env/dynamic/private`) and by Node scripts
(drizzle-kit, seeds). What each variable needs locally:

| Variable                                             | Local value                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ORIGIN`                                             | `http://localhost:5173` — **required**, better-auth throws without it                                                          |
| `BETTER_AUTH_SECRET`                                 | Any string locally (32+ chars high-entropy in real environments)                                                               |
| `DATABASE_URL`                                       | Leave as-is/blank — Postgres is only for the pre-cutover bridge scripts, not the app                                           |
| `PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | **Leave blank** — blank means Cloudflare's always-pass test keys (per the comment in `.env.example`), so sign-up works offline |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`        | Blank unless you're testing payment flows (see §6)                                                                             |
| `R2_*`                                               | Blank — media storage is emulated locally by the platform proxy                                                                |

There is also `.dev.vars` (gitignored, no template): wrangler's equivalent of `.env`, read
by anything that goes through wrangler's platform proxy — e.g. the Playwright global setup
and `pnpm help:sync`. For most day-to-day work you won't need it; if a script complains
about a missing secret, mirror the value from `.env` into `.dev.vars`.

## 3. Database: migrate and seed

```bash
pnpm db:reset
```

This deletes `.wrangler/state/v3/d1` (the local D1 SQLite state), replays every
`migrations/*/migration.sql` through `wrangler d1 execute corvmc-db --local`, and runs the
seed (`scripts/seed-dev.ts`). The seed creates roles, ~dozens of members with realistic
names, bands, reservations (past and future, in every status), recurring series, events
with tickets and RSVPs, credits, equipment, marketing data, and help articles.

**Login:** the seed creates exactly one account with a password:

```
admin@corvallismusic.org / password        (admin + staff + member roles)
```

All other seeded users have no credential account — to test as a plain member, sign up
through the UI (Turnstile passes with the blank/test keys) or use the admin's staff
console.

Re-run `pnpm db:reset` any time the data gets weird; it's the supported path back to a
known state. To apply _new_ migrations without wiping data there is no tracked local
migrate — `db:migrate:local` replays _all_ migration files, which errors on already-applied
ones, so in practice: reset.

## 4. Run

```bash
pnpm dev          # http://localhost:5173
```

The Cloudflare bindings (`DB`, `R2_BUCKET`, `KV`) are emulated in dev and preview by
`@sveltejs/adapter-cloudflare` via wrangler's platform proxy, reading `wrangler.toml` and
the local state dir. If you see `Missing platform bindings: ...` in the console, that check
is `validateEnv()` in `src/hooks.server.ts` — it usually means the dev server started in a
context where the proxy couldn't initialize.

Feature-flagged areas (inbox, marketing, equipment, band premium/reservations/events, help
center) are **off by default** — the flags are KV site-config keys with `false` defaults.
Turn them on at `/staff/settings` as the admin user, or leave them off; see
[feature flags in the overview](../architecture/overview.md#configuration-three-tiers).

Other useful processes:

```bash
pnpm storybook    # component workshop on :6006
pnpm check:watch  # svelte-check in watch mode
pnpm db:studio    # drizzle-kit studio (needs CLOUDFLARE_* vars → points at REMOTE D1; be careful)
```

## 5. Tests

| Command                | What runs                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:unit`       | Vitest, watch mode — `server` project (node, `src/**/*.{test,spec}.ts` + `scripts/**` + `e2e/**` helpers) and `client` project (real Chromium browser, `src/**/*.svelte.{test,spec}.ts`)   |
| `pnpm test:components` | One-shot client + storybook story tests                                                                                                                                                    |
| `pnpm test:e2e`        | Playwright — builds, runs `vite preview` on :4173 (a worktree gets its own port), migrates + seeds its own D1 via `e2e/prepare.ts`, runs `e2e/**/*.e2e.ts`, then clears the database again |
| `pnpm test`            | Everything (unit one-shot + e2e) — what CI runs                                                                                                                                            |

Notes: every test must make at least one assertion (`expect.requireAssertions` is on
globally in `vite.config.ts`). The e2e web server injects dummy Stripe/auth env so it runs
without real keys (see `playwright.config.ts`). It keeps its database in
`.wrangler/e2e-state`, not the `.wrangler/state` your dev server uses — the suite never
touches your dev data, and `pnpm dev` can keep running while it does. Delete that directory
to force a rebuild; `e2e/prepare.ts` rebuilds it by itself whenever the migrations change.

A passing run empties that database on the way out (`e2e/run.ts` → `e2e/reset-db.ts`), so it
is not left holding the run's rows. A **failing** run keeps them, because what the app wrote
is usually the most useful thing you have — clear it by hand with `pnpm tsx e2e/reset-db.ts`
when you're done looking. Either way `e2e/prepare.ts` clears it again before seeding, so a
crash or a Ctrl-C can't leave rows for the next run to trip over.

Run the minimum tests you need while iterating; save `pnpm test` for pre-commit.

Lint/format: `pnpm lint` (check), `pnpm format` (write), `pnpm lint:changed` (only files
changed vs `origin/main` — what PR CI runs).

## 6. Stripe locally (optional)

Only needed when working on payment flows:

1. Put a **test-mode** key in `.env`: `STRIPE_SECRET_KEY=sk_test_...`.
2. Forward webhooks to the local app with the Stripe CLI:

   ```bash
   stripe listen --forward-to localhost:5173/api/stripe/webhook
   ```

   Copy the printed `whsec_...` into `.env` as `STRIPE_WEBHOOK_SECRET` and restart dev.

3. Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.

Without this, booking still works — the checkout redirect will just fail at the Stripe
step, and confirm-without-payment flows are fully testable.

## 7. Troubleshooting

| Symptom                                                    | Fix                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN environment variable is required` on first request | Set `ORIGIN=http://localhost:5173` in `.env`, restart                                                                                             |
| `Database not initialized — call initDb(d1)...`            | You're running server code outside a request (e.g. a bare `tsx` script). Scripts must create their own DB handle like `scripts/seed-dev.ts` does. |
| `no such table: ...`                                       | Migrations not applied to the local DB — `pnpm db:reset`                                                                                          |
| `db:migrate:local` errors on `CREATE TABLE`                | It replays _all_ migrations against an existing DB; use `pnpm db:reset` instead                                                                   |
| Sign-up rejected with "Verification failed"                | Turnstile keys are set but wrong; blank both keys locally to use the always-pass test mode                                                        |
| Commit mangled / files reformatted on commit               | That's lefthook's prettier/eslint `--fix` pre-commit hook doing its job                                                                           |
| Email layout changes not showing                           | The MJML layout compiles at `prepare`/`build` — run `pnpm tsx scripts/compile-email-layouts.ts` or restart after `pnpm install`                   |
| Port 5173 busy                                             | Another dev server is in the _same_ checkout (worktrees get their own port). Stop it, or `PORT=5174 pnpm dev` (update `ORIGIN` to match)          |
| Storybook stories fail in vitest                           | The `storybook` vitest project needs the Chromium install: `pnpm exec playwright install chromium`                                                |

## Where to next

- [Architecture overview](../architecture/overview.md) — how the app is wired
- [Business workflows](business-workflows.md) — what the code does, traced end-to-end
- [Conventions](conventions.md) — the rules the codebase follows (and lints for)
- [UI patterns](ui-patterns.md) — mandatory reading before touching any page
