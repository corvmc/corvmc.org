# CorvMC

The member platform for the [Corvallis Music Collective](https://corvmc.org): practice-room
reservations, sustaining memberships, bands, ticketed events, equipment loans, a member
directory, email marketing, a staff support inbox, and smart-lock door access — one
SvelteKit app running entirely on Cloudflare Workers.

> **This app is canonical.** It is a rewrite of a legacy Laravel/Postgres system, and that
> migration is done — D1 is the production data store and the legacy app is no longer active.
> One thread remains: passwords still on bcrypt cannot be verified on Workers, so sign-in for
> accounts that have not signed in since the move proxies to the legacy server, which is why
> it stays up. The Postgres sync and ETL scripts have been deleted — D1 is canonical, so
> there is no longer any supported path from Postgres into it. See
> [the operations manual §6](docs/architecture/operations-manual.md).

## Stack at a glance

| Piece            | Choice                                               | Why it matters to a maintainer                                                                            |
| ---------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Framework        | SvelteKit 2 / Svelte 5 (runes)                       | Data flows through **remote functions** (`query()`/`form()`), not load functions — see the overview       |
| Runtime          | Cloudflare Workers (`@sveltejs/adapter-cloudflare`)  | One Worker, no servers; deploys happen via Cloudflare Workers Builds watching this repo                   |
| Database         | Cloudflare D1 (SQLite) + Drizzle ORM                 | **No transactions** — `db.batch()` only (lint-enforced); migrations are generated, forward-only           |
| Storage / config | R2 (media), KV (runtime site config + feature flags) | Feature flags are KV keys; staff toggle them without a deploy                                             |
| Auth             | better-auth (email+password, scrypt)                 | Custom hashing for Workers; leftover bcrypt hashes verify via the old Laravel app, then rewrite to scrypt |
| Payments         | Stripe (Checkout, subscriptions, one webhook)        | Fulfillment is webhook-driven → event bus → per-domain listeners                                          |
| Email            | Postmark (transactional + broadcast streams)         | Templates live in `postmark/`, synced with `pnpm email:push/pull`                                         |
| SMS              | Twilio (support inbox)                               | Phone number not yet provisioned; outbound dormant                                                        |
| Door locks       | U-Tec/Ultraloc API                                   | Daily provisioning via a cron endpoint                                                                    |
| Errors/traces    | Sentry (+ Cloudflare native OTLP export)             | Initialized per-request in `hooks.server.ts`                                                              |
| Scheduled jobs   | Plain HTTP endpoints under `/api/cron/*`             | Triggered by native Cloudflare cron triggers (`worker.js` scheduled handler) — see the operations manual  |

## Quickstart

```bash
corepack enable                 # Node 22, pnpm 9.15.x (pinned)
pnpm install                    # also installs git hooks
cp .env.example .env            # set ORIGIN=http://localhost:5173, leave Turnstile blank
pnpm db:reset                   # wipe + migrate + seed the local D1
pnpm dev                        # http://localhost:5173
```

Log in as `admin@corvallismusic.org` / `password` (seeded admin). Full walkthrough,
including Stripe test mode and troubleshooting:
[docs/development/local-dev-quickstart.md](docs/development/local-dev-quickstart.md).

## Documentation

Start at the [docs index](docs/README.md). New maintainer? Read in this order:

1. [Local dev quickstart](docs/development/local-dev-quickstart.md) — get it running
2. [Architecture overview](docs/architecture/overview.md) — how the app is wired (remote
   functions, guards, event bus, D1, cron, config)
3. [Business workflows](docs/development/business-workflows.md) — the eight core flows,
   traced through code
4. [Conventions](docs/development/conventions.md) — the rules (and lint) the codebase
   follows, plus the full script reference
5. [Operations manual](docs/architecture/operations-manual.md) — deploys, migrations,
   secrets, integrations, cron, monitoring
6. [Deployment checklist](docs/architecture/deployment-checklist.md) — first-time
   provisioning only

Also: [ui-patterns.md](docs/development/ui-patterns.md) (mandatory before touching pages),
`docs/specs/` (per-feature design intent), `docs/manual/` + `src/content/help/` (the
end-user help articles).

## Common commands

```bash
pnpm dev                # dev server :5173
pnpm check              # svelte-check (types)
pnpm lint               # prettier + eslint
pnpm test:unit          # vitest (watch)
pnpm test               # full suite: unit + Playwright e2e (what CI runs)
pnpm db:generate        # create a migration from schema changes (review the SQL!)
pnpm db:reset           # wipe + migrate + seed local D1
pnpm storybook          # component workshop :6006
pnpm docs:check         # docs integrity + route drift (CI gate)
pnpm help:sync          # push help articles into the D1 help tables
```

The complete annotated list is in
[conventions.md](docs/development/conventions.md#pnpm-script-reference).

## Deploying

Push to `main`. Cloudflare Workers Builds runs `pnpm build` and publishes the Worker;
`build` applies pending migrations before `vite build`, and a failed migration aborts the
deploy.
GitHub Actions run checks only. Rollback, manual deploys, and everything else operational:
[operations manual](docs/architecture/operations-manual.md).
