# Operations Manual

Day-to-day operation of the production app: deploying, migrating the database, managing
secrets, keeping the third-party integrations healthy, running scheduled jobs, and
maintaining the docs. For **first-time provisioning** (creating the D1 database, R2 bucket,
initial secrets, Stripe webhook, custom domain), use the
[deployment checklist](deployment-checklist.md) instead — this manual assumes production
already exists.

See the [architecture overview](overview.md) for how the pieces fit together.

## 1. How deploys work

There is no deploy button in this repo and **no GitHub Action deploys**. Deployment is
handled by **Cloudflare Workers Builds**, which watches the GitHub repo:

1. A PR reaches the front of the merge queue, which puts its commit on a temporary
   `gh-readonly-queue/main/pr-<n>-<sha>` branch, or you push to `main` directly.
2. Cloudflare's build system runs the build command configured in the Cloudflare dashboard
   (Workers & Pages → corvmc → Settings → Build):

   ```
   pnpm ci:migrate && pnpm build
   ```

3. `pnpm ci:migrate` runs `scripts/ci-migrate.mjs`, which applies any pending D1 migrations
   **only for a build that publishes to production** — `main` itself, or a
   `gh-readonly-queue/main/*` merge queue branch. It reads `WORKERS_CI_BRANCH` (falling back
   to `CF_PAGES_BRANCH`) and exits 0 without touching the database on any other branch. If
   the migration fails, the whole build fails and **nothing is published** — the old Worker
   keeps serving.

   The queue branch counts as production because Cloudflare builds and publishes it, then
   does **not** build again when the queue fast-forwards `main` onto that same SHA — the
   queue build is the only one a queued PR ever gets. #241 landed before this was true and
   its `band_member.alias` migration was skipped while its code went live, so
   `/directory/bands/[slug]` 500ed in production until the migration was applied by hand.
   `scripts/ci-migrate.spec.ts` pins the branch matching.

4. `pnpm build` compiles the MJML email layout (`scripts/compile-email-layouts.ts`) and
   then runs `vite build`; the Worker is published from `.svelte-kit/cloudflare/`.

The load-bearing configuration lives in the Cloudflare dashboard, not the repo:

- the build command above;
- three **build environment variables** used by `drizzle.config.ts` for the remote migrate:
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN` (an API
  token scoped Account → D1 → Edit);
- which branches Cloudflare builds at all. It currently builds non-production branches, which
  is what puts the merge queue's branch in front of the `main` push. A plain PR branch build
  only uploads a version — `wrangler deployments list` shows no deployment for it — while the
  queue branch's build is promoted to 100% of traffic, which is why the two are treated
  differently. Turning non-production builds off would make Cloudflare build `main` instead;
  the migrate step works either way, but if you change it, check that a queued PR's build log
  still says "applying D1 migrations to remote".

GitHub Actions (`.github/workflows/ci.yml`) run **checks only**, on PRs and pushes to
`main`: prettier+eslint (`lint` on push, `lint:changed` on PRs), `svelte-check`, the full
test suite (unit + Playwright e2e), a schema-drift gate (`drizzle-kit check` +
`drizzle-kit generate` must produce no new files under `migrations/` — i.e. every schema
change has its migration committed), and the docs-integrity gate
(`node scripts/docs/check-docs-drift.mjs --ci`). CI failing does not block the Cloudflare
deploy mechanically — treat a red CI on `main` as an incident.

### Manual deploy (fallback)

From a machine with `wrangler login`:

```bash
pnpm db:migrate          # apply pending migrations to remote D1
pnpm check && pnpm lint && pnpm test
pnpm build
wrangler deploy
```

### Rollback

- **Code:** `wrangler rollback` reverts to the previous Worker version. Instant.
- **Schema:** there is no automatic rollback — migrations are **forward-only**. If a
  migration is bad, write a new migration that fixes it (`pnpm db:generate` after
  correcting the schema files, or a hand-reviewed corrective SQL) and deploy again. The old
  Worker code must still be compatible with the migrated schema while you do this, which is
  why additive migrations (add column, add table) are strongly preferred over renames and
  drops.
- **Emergency data fix:**
  `wrangler d1 execute corvmc-db --remote --command "UPDATE ... WHERE ..."` — take a copy
  of the affected rows first (`--command "SELECT ..."`).

## 2. Database operations

Schema source of truth: `src/lib/server/db/schema/`. Migrations: `migrations/<timestamp>_<name>/migration.sql`.

| Task                                     | Command                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Generate a migration from schema changes | `pnpm db:generate` (review the SQL it writes before committing)                                        |
| Apply migrations to **remote** D1        | `pnpm db:migrate` (needs the three `CLOUDFLARE_*` vars in `.env`)                                      |
| Apply migrations to **local** D1         | `pnpm db:migrate:local` (replays every `migrations/*/migration.sql` via `wrangler d1 execute --local`) |
| Wipe + rebuild + seed local DB           | `pnpm db:reset`                                                                                        |
| Browse remote data in a GUI              | `pnpm db:studio` (drizzle-kit studio, same `CLOUDFLARE_*` vars)                                        |
| Ad-hoc remote SQL                        | `wrangler d1 execute corvmc-db --remote --command "SELECT count(*) FROM user"`                         |

Notes:

- Remote migration state is tracked by drizzle-kit (idempotent — re-running `db:migrate`
  applies only pending migrations). The local loop in `db:migrate:local` is **not**
  tracked; it's only safe because it always starts from a wiped `.wrangler/state/v3/d1`
  (that's what `db:reset` does).
- `db.transaction()` doesn't exist on D1; multi-statement writes use `db.batch()`. See the
  [overview](overview.md#database).

## 3. Secrets and configuration

Three places hold configuration; know which is which before changing anything:

| Where                  | What                                                                                                                   | How to change                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `wrangler.toml [vars]` | Non-secret deploy-time config (URLs, sender identity, Postmark message streams, Turnstile **site** key, `LARAVEL_URL`) | Edit the file, deploy                        |
| Worker secrets         | Everything sensitive (table below)                                                                                     | `wrangler secret put NAME`, or bulk (below)  |
| KV site config         | Runtime settings + feature flags (`site-config:*` keys)                                                                | Staff settings UI, or `wrangler kv` directly |

Bulk secret upload: copy `secrets.template.json` → `.secrets.json` (gitignored), fill in,
**delete the `_README` key** (or wrangler creates a secret literally named `_README`), then
`wrangler secret bulk .secrets.json`.

### Secret inventory

| Secret                                                                    | Used by                                                                                                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                                      | Session/signing key for better-auth (`src/lib/server/auth.ts`)                                                                                        |
| `CRON_SECRET`                                                             | Bearer token every `/api/cron/*` endpoint requires; sent by the Worker's own `scheduled` handler (`worker.js`) and by manual curl invocations         |
| `MIGRATION_SECRET`                                                        | Shared secret for the legacy-Laravel `verify-password` proxy (pre-cutover only)                                                                       |
| `DATABASE_URL`                                                            | **Not read by the Worker** (no references in `src/`). The Postgres bridge scripts read it from `.env` locally. Remove from Worker secrets at cutover. |
| `MARKETING_UNSUBSCRIBE_SECRET`                                            | Signs unsubscribe links (`src/lib/server/marketing/unsubscribe.ts`)                                                                                   |
| `STRIPE_SECRET_KEY`                                                       | All Stripe API calls (`src/lib/server/stripe.ts`)                                                                                                     |
| `STRIPE_WEBHOOK_SECRET`                                                   | Webhook signature verification (`src/routes/api/stripe/webhook/+server.ts`)                                                                           |
| `STRIPE_WEBHOOK_ID`                                                       | Which endpoint `pnpm stripe:sync-webhooks` manages                                                                                                    |
| `POSTMARK_SERVER_TOKEN`                                                   | Outbound email (`src/lib/server/notification/email/postmark-client.ts`) + the `email:push/pull` CLI                                                   |
| `POSTMARK_INBOUND_TOKEN`                                                  | Authenticates Postmark's inbound webhook (`src/routes/api/inbox/postmark/+server.ts`) — sent as the HTTP Basic _password_ in the hook URL             |
| `INBOX_REPLY_SECRET`                                                      | Signs the thread id in inbox reply addresses (`src/lib/server/inbox/reply-address.ts`). Optional — falls back to `POSTMARK_SERVER_TOKEN`              |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`                                | SMS send/receive (`src/lib/server/inbox/twilio-client.ts`)                                                                                            |
| `META_APP_SECRET` / `META_PAGE_ACCESS_TOKEN` / `META_VERIFY_TOKEN`        | Messenger inbox channel (`src/routes/api/inbox/meta/+server.ts`) — provisioned but dormant                                                            |
| `ULTRALOC_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_DEVICE_ID` | U-Tec smart-lock API (`src/lib/server/lock/ultraloc-client.ts`)                                                                                       |
| `TURNSTILE_SECRET_KEY`                                                    | Server-side Turnstile verification (`src/lib/server/turnstile.ts`)                                                                                    |

Local equivalents: Worker secrets go in **`.dev.vars`** (read by `vite dev` / wrangler),
Node-script vars (drizzle-kit, seed, bridge scripts) go in **`.env`**. Both are gitignored;
`.env.example` documents the local set.

> **Action item:** `wrangler.toml` currently ships Cloudflare's **always-pass test key** as
> `PUBLIC_TURNSTILE_SITE_KEY` (the comment in the file says so). Until it's replaced with a
> real site key + matching `TURNSTILE_SECRET_KEY`, the bot protection on sign-up/contact/
> subscribe passes everyone.

## 4. Third-party integrations

### Stripe

- API key: `STRIPE_SECRET_KEY`. All server calls go through `getStripe()` in
  `src/lib/server/stripe.ts`.
- **One webhook endpoint** at `https://corvmc.org/api/stripe/webhook`. The set of
  subscribed events is code-defined in `src/lib/server/finance/webhook-events.ts`
  (`checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`,
  `customer.subscription.deleted`). After changing that list, run:

  ```bash
  pnpm stripe:sync-webhooks
  ```

  `scripts/sync-webhooks.ts` updates the endpoint identified by `STRIPE_WEBHOOK_ID` to
  exactly the registered events (prints an added/removed diff). With no `STRIPE_WEBHOOK_ID`
  but `APP_URL` set, it **creates** a new endpoint and prints the new secret + id for you
  to store.

- Triage: Stripe dashboard → Developers → Webhooks shows delivery attempts and lets you
  re-send. The route returns 500 on handler failure precisely so Stripe retries.

### Postmark (email)

- Two message streams on one server token: one for receipts and reminders, one for
  marketing campaigns. Their ids come from `POSTMARK_TRANSACTIONAL_STREAM` and
  `POSTMARK_BROADCAST_STREAM` in `wrangler.toml [vars]` (currently
  `corvmc-transactional` / `corvmc-broadcast`). Both are **required** — there is no
  fallback, and every send throws `POSTMARK_<...>_STREAM is not configured` when unset.
  Because these are custom streams rather than Postmark's defaults
  (`outbound`/`broadcast`), a Postmark server pointed at by a different
  `POSTMARK_SERVER_TOKEN` must have streams with the configured ids or every send is
  rejected. Client: `src/lib/server/notification/email/postmark-client.ts`.
  Note the id `corvmc-transactional` is also, coincidentally, the alias of the Postmark
  **layout template** under `postmark/templates/_layouts/` — unrelated concepts.
- **Transactional templates** live in the repo under `postmark/templates/` and are synced
  with Postmark's CLI: `pnpm email:push` (repo → Postmark) / `pnpm email:pull`
  (Postmark → repo), both using `$POSTMARK_SERVER_TOKEN` from your shell. The repo is the
  source of truth — see `docs/postmark-template-migration.md`.
- The **campaign layout** is different: it's MJML, compiled to a TS constant at build time
  by `scripts/compile-email-layouts.ts` (runs in both `pnpm prepare` and `pnpm build`) into
  `src/lib/server/generated/`.
- **Inbound email** (support inbox) is a Postmark inbound webhook pointed at
  `/api/inbox/postmark`, authenticated by `POSTMARK_INBOUND_TOKEN`. A separate delivery-
  events webhook posts to `/api/webhooks/postmark`.
- **Inbound auth is HTTP Basic in the URL**, not a header. Postmark's "up to 30 custom
  headers" feature belongs to _modular_ (message-event) webhooks — which is why
  `/api/webhooks/postmark/events` can use `x-postmark-token`. The inbound hook is a bare
  `InboundHookUrl`, so configure it as
  `https://postmark:<POSTMARK_INBOUND_TOKEN>@corvmc.org/api/inbox/postmark`. The route also
  accepts `x-postmark-token` for local curl testing, and **rejects every request when the
  secret is unset**.
- **Reply routing.** Staff replies go out with a plus-addressed
  `Reply-To: reply+<threadId>.<sig>@replies.corvmc.org`. Postmark parses the part after the
  `+` into the inbound payload's `MailboxHash`, which routes the response straight back into
  its original thread (`src/lib/server/inbox/reply-address.ts`). The thread id is HMAC-signed
  — without that the address is a bearer token for writing into a thread, and it is visible
  to anyone the recipient forwards our reply to.
  - Requires `MX replies.corvmc.org → inbound.postmarkapp.com` (priority 10) and _Inbound
    domain forwarding_ set to `replies.corvmc.org` in the Postmark server settings.
  - **Enabled** as of 2026-08-19: the MX is live and `INBOX_REPLY_ADDRESS` is set in
    `wrangler.toml`. Unsetting it is the rollback — replies fall back to
    `Reply-To: STAFF_CONTACT_EMAIL`, a human rather than a bounce. Enablement steps and the
    reply-routing troubleshooting table: [inbox-reply-setup.md](inbox-reply-setup.md).
  - **Never point `corvmc.org`'s root MX at Postmark** — `contact@corvmc.org` is a live
    mailbox. Also confirm Cloudflare Email Routing is off for the zone; it claims the zone's
    MX records.
- The `email` **channel toggle** (Staff → Settings → Inbox Channels) gates only _new-sender_
  mail. A reply to a thread we started always lands, because we invited it.

### Twilio (SMS)

Support-inbox SMS channel. `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` secrets; inbound
messaging webhook → `/api/inbox/twilio`. **`TWILIO_PHONE_NUMBER` is intentionally unset**
(no number provisioned yet — noted in `wrangler.toml`); outbound SMS is dormant until it
exists as a `[vars]` entry.

### U-Tec / Ultraloc (door locks)

Smart-lock access for the practice space. Client code in `src/lib/server/lock/`
(`ultraloc-client.ts`, `utec-oauth.ts`); OAuth handshake routes under
`src/routes/api/integrations/utec/`; four `ULTRALOC_*` secrets; daily provisioning via the
`lock-access` cron. A Postman collection for the vendor API is checked in at
`docs/U-Tec Api.postman_collection.json`.

### Turnstile (bot protection)

Widget on public sign-up/contact/subscribe forms. Site key in `wrangler.toml [vars]`
(public), secret key as a Worker secret. See the action item in §3 — the shipped site key
is the always-pass test key.

### Sentry (errors + traces)

- SDK events: DSN hardcoded in `src/lib/sentry-dsn.ts`, initialized per-request in
  `src/hooks.server.ts`. Releases are tagged from the Worker version metadata binding.
- Cron check-ins: every scheduled job reports Sentry Crons check-ins over the plain HTTP
  check-in API (`src/lib/server/cron/sentry-check-in.ts` — no SDK involved; the per-request
  SDK client doesn't exist when a `scheduled` invocation starts). See §5 for the monitors.
- Platform traces/logs: `wrangler.toml [observability.*]` exports OTel data to
  destinations named `sentry-traces` / `sentry-logs`, which must exist in the Cloudflare
  dashboard (Workers & Pages → Observability → Destinations) pointing at Sentry's OTLP
  endpoint. If those destinations are deleted, the export silently stops — recreate them
  with exactly those names.

### Meta / Messenger

Secrets exist (`META_*`) and an inbound route exists (`/api/inbox/meta`), but the channel
is not actively provisioned. Treat as dormant.

## 5. Cron

All scheduled work is HTTP — see the [overview](overview.md#scheduled-work-cron) for the
full endpoint table. Requirements:

```
POST https://corvmc.org/api/cron/<name>
Authorization: Bearer <CRON_SECRET>
```

**The schedule lives in this repo, on native Cloudflare cron triggers.** The `[triggers]`
block in `wrangler.toml` defines the cron expressions; the `scheduled` handler in
`worker.js` (the wrangler `main` entry) maps each firing to its endpoints via
`src/lib/server/cron/schedule.ts` and calls them **in-process** through the generated
worker's own `fetch` export — no external scheduler, no network hop. Deploying the Worker
registers the triggers; trigger changes take up to 15 minutes to propagate.

Cron expressions are **UTC only** (no DST handling), so the Pacific wall-clock times below
shift an hour when DST flips:

| Cron (UTC)     | Endpoints, in order                                                                                                                                                           | Pacific                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `*/5 * * * *`  | `/api/cron/send-campaigns`                                                                                                                                                    | every 5 min              |
| `*/15 * * * *` | `/api/cron/auto-complete`, `/api/cron/cancel-unconfirmed`, `/api/cron/expire-waitlisted`                                                                                      | every 15 min             |
| `0 16 * * *`   | `/api/cron/generate-recurring-reservations`, `/api/cron/lock-access`, `/api/cron/confirmation-reminders`, `/api/cron/reservation-reminders`, `/api/cron/cancel-stale-tickets` | daily, 8am PST / 9am PDT |

The daily batch runs its jobs sequentially in the order listed — generation first, so
freshly generated occurrences are visible to lock provisioning and the reminder sweeps.
Keep the table above, `wrangler.toml [triggers]`, and `CRON_SCHEDULE` in
`src/lib/server/cron/schedule.ts` in sync (the schedule spec pins the map).

Manual invocation (safe — every job is idempotent and returns a JSON summary):

```bash
curl -s -X POST https://corvmc.org/api/cron/cancel-unconfirmed \
  -H "Authorization: Bearer $CRON_SECRET"
```

A `401` means the secret doesn't match; a `500 CRON_SECRET not configured` means the
Worker secret is missing. If reservations pile up unresolved, reminders stop, or recurring
series stop generating: check **Sentry → Insights → Crons** first (see below), then the
Worker's cron events in the Cloudflare dashboard (Workers & Pages → corvmc → Settings →
Triggers shows the schedules; the logs show `[cron]`-prefixed per-job lines) and confirm
the latest deploy succeeded — triggers only update on deploy. The endpoints themselves
have unit tests.

**Monitoring (Sentry Crons).** The `scheduled` handler brackets every job with
`in_progress` → `ok`/`error` check-ins over Sentry's HTTP check-in API
(`src/lib/server/cron/sentry-check-in.ts`), so Sentry alerts on failed **and missed**
runs. One monitor per endpoint, slugged by basename (`auto-complete`, `send-campaigns`,
…), visible under Sentry → Insights → Crons. Monitors are **upserted from the check-ins
themselves** — schedule changes in `wrangler.toml [triggers]` propagate on the next run;
nothing to configure in the Sentry dashboard. Check-ins go to the `production` monitor
environment by default; when testing locally, keep test noise out of production
missed-run detection by passing a different environment:

```bash
npx wrangler dev --test-scheduled --var CRON_SECRET:local-test --var SENTRY_ENVIRONMENT:development
```

## 6. The Postgres bridge (pre-cutover only)

Until cutover, the legacy Laravel/Postgres app is canonical and this app's D1 is a staging
copy. Two pieces of machinery exist solely for this window:

- **`pnpm db:sync`** (`scripts/sync-d1.sh`) — reloads all remote D1 **data** (schema and
  migration history are preserved) from the DigitalOcean Postgres. It is **destructive to
  remote D1 data** and prompts before running (`pnpm db:sync -- --yes` to skip). It must
  run from a host that is a DigitalOcean _Trusted Source_ (in practice: the laptop), needs
  `DATABASE_URL` (shell or `.env`, `?sslmode=require`) and wrangler auth, and stashes/
  restores your local dev D1 around the run. If you've added migrations since the last
  deploy, run `pnpm db:migrate` first so the remote schema matches. Pipeline: local rebuild
  from migrations → ETL (`scripts/migrate-from-postgres.ts --commit`) → export → FK-safe
  reorder (`scripts/reorder-seed.mjs`, order in `scripts/d1-table-order.mjs`) → generated
  deletes (`scripts/gen-d1-delete.mjs`) → clear remote → import.
- **bcrypt sign-in proxy** — un-migrated users' passwords verify against the Laravel app
  (`LARAVEL_URL` + `MIGRATION_SECRET`) and are rewritten to scrypt on success. See the
  [overview](overview.md#password-hashing-three-formats-coexist).

**Cutover teardown** (also listed in [deployment-checklist §10a](deployment-checklist.md)):
delete `scripts/sync-d1.sh`, `scripts/migrate-from-postgres.ts`, `scripts/reorder-seed.mjs`,
`scripts/gen-d1-delete.mjs`, `scripts/d1-table-order.mjs`; remove the bcrypt proxy path in
`src/lib/server/auth.ts`; remove `LARAVEL_URL` from `wrangler.toml` and the
`MIGRATION_SECRET` / `DATABASE_URL` Worker secrets.

## 7. Keeping the docs healthy

Two mechanisms keep documentation in sync with the code; the manual one works with no AI
involved and is the one you should know cold.

### The manual procedure

The deterministic checker is `scripts/docs/check-docs-drift.mjs` (plain Node, no deps):

```bash
pnpm docs:check
```

It validates **help-content integrity** (frontmatter parses, slugs unique, internal
`/member/help/<slug>` links resolve, every `static` slug seeded in `scripts/seed-dev.ts`
has a backing file) and reports **route drift** — routes added/removed compared to the
committed snapshot `docs/manual/route-inventory.json`. Exit codes: 0 clean, 1 findings, 2
script error; it always writes `docs-drift-report.json` (gitignored working artifact).
CI runs it with `--ci`, which fails **only** on integrity errors — route drift there is
informational.

When you add, move, or remove a route:

1. Write/update the matching help article in `src/content/help/<category>/<slug>.md`
   (frontmatter: `title`, `slug`, `category`, `summary`, `minRole`, `sortOrder`) and the
   manifest entry in `docs/manual/README.md`.
2. Regenerate the route snapshot: `pnpm docs:routes` (commits the updated
   `route-inventory.json`).
3. `pnpm docs:check` — must come back clean.
4. Sync articles into the D1 database: `pnpm help:sync`
   (`scripts/sync-help-articles.ts` — upserts `source='static'` articles and deletes
   orphaned static rows). It connects through wrangler's `getPlatformProxy()`, i.e. the
   **local** D1 state; getting the content into production means running the sync against
   the production database (verify your wrangler remote-binding setup before assuming this
   — the script itself has no `--remote` flag).

There is no automation behind this — the procedure above is the whole mechanism. A
`nightly-docs-sync.yml` workflow used to run a detector and have Claude draft a docs-only
PR from it; it was removed in August 2026, having failed on every scheduled run because
the `ANTHROPIC_API_KEY` secret it needs was never added. `pnpm docs:check` in CI remains
the only automatic gate, and it checks integrity, not staleness.

Also keep current as you change things:

- `docs/README.md` — the index; every doc gets a row and a status emoji.
- `docs/reports/parity-report.md` — the feature matrix vs. the legacy app; add a row per
  shipped feature (see [conventions](../development/conventions.md)).

## 8. Monitoring and incident triage

- **Sentry** is the first stop for 5xx errors — the app deliberately filters bot-probe
  404s and other 4xx noise, so what's there is real. Auth anomalies are tagged
  `event: auth.sign_in` / `auth.bcrypt_migration`.
- **Live logs:** `wrangler tail` streams production console output.
- **Cloudflare dashboard:** Workers & Pages → corvmc → Logs / Observability for platform
  traces (D1 query timing, KV/R2 ops) exported to Sentry.
- **Deploy history:** Workers & Pages → corvmc → Deployments (this is also where
  `wrangler rollback` targets show up).

Failure signatures by symptom:

| Symptom                                     | First place to look                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paid but not confirmed (reservation/ticket) | Stripe → webhook deliveries; Sentry `stage: 'handler'`. See [workflows §1/§5](../development/business-workflows.md).                                               |
| Credits missing after renewal               | Stripe `invoice.paid` delivery; `creditTransaction` ledger. [Workflows §3](../development/business-workflows.md#3-membership-signup-subscription-monthly-credits). |
| Reservations stuck / reminders silent       | Sentry → Insights → Crons (missed/failed monitors), then Cloudflare cron events and the endpoint's JSON result (§5).                                               |
| Sign-in failures for old accounts           | Sentry `auth.bcrypt_migration` events; is the Laravel app up? (pre-cutover)                                                                                        |
| Emails not arriving                         | Postmark activity stream (transactional vs broadcast), then Sentry.                                                                                                |
| Site-wide 500s right after a deploy         | `wrangler tail`; consider `wrangler rollback`; check whether a migration ran.                                                                                      |
| Feature "missing" in production             | Feature flag in KV site config (`feature.*`) — staff settings UI.                                                                                                  |
