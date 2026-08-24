# Deployment Checklist

First-time production deployment for corvmc-svelte — a rewrite of corvmc-redux (Laravel/Postgres) on Cloudflare Workers + D1.

> This checklist covers **first-time provisioning**. For day-to-day operations (routine
> deploys, migrations, secrets, integration upkeep, cron, monitoring), see the
> [operations manual](operations-manual.md).

---

## Prerequisites

- [ ] Cloudflare account with Workers paid plan
- [ ] Wrangler CLI installed (`pnpm add -g wrangler`) and authenticated (`wrangler login`)
- [ ] Stripe account with live API keys
- [ ] `pg_dump -Fc` backup of the production Postgres database
- [ ] Local Postgres instance for restoring the dump (for the migration script)
- [ ] Node.js 20+ and pnpm installed

---

## 1. Cloudflare Resource Setup

### Create D1 Database

```bash
wrangler d1 create corvmc-db
```

Copy the returned `database_id` and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "corvmc-db"
database_id = "<paste-real-id-here>"
```

Migrations are applied with `pnpm db:migrate` (Drizzle Kit over `d1-http`), not
`wrangler d1 migrations apply`, so no `migrations_dir` key is needed here.

### Create R2 Bucket (if file uploads needed)

```bash
wrangler r2 bucket create corvmc-uploads
```

### Set Secrets

```bash
wrangler secret put BETTER_AUTH_SECRET
# Enter a 32+ character high-entropy string

wrangler secret put ORIGIN
# Enter the production URL, e.g. https://corvmc.com

wrangler secret put STRIPE_SECRET_KEY
# Enter sk_live_... key

# R2 bucket is configured as a binding in wrangler.toml (no credentials needed)
wrangler secret put R2_PUBLIC_URL
```

---

## 2. Apply D1 Migrations

```bash
pnpm db:migrate        # = drizzle-kit migrate, applies migrations/ to remote D1 over d1-http
```

This applies every pending migration in `migrations/` to the D1 configured in
`drizzle.config.ts` (driver `d1-http`, pointed at `CLOUDFLARE_DATABASE_ID`) and records
each one in a `__drizzle_migrations` tracking table so it is only ever applied once.

> Requires the `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_DATABASE_ID` / `CLOUDFLARE_D1_TOKEN`
> env vars (see [Drizzle Kit Remote Access](#drizzle-kit-remote-access)).
>
> **Do not use `drizzle-kit push`** for production. `push` diffs the schema and mutates
> the database directly with no migration files and no tracking — it can silently drop
> columns. Migration files in `migrations/` are the single source of truth.
>
> **First time only — bootstrap the tracking table.** `drizzle-kit migrate` expects an
> empty database it builds up from migration 0001. On a D1 that already has tables (e.g.
> applied by hand), it will try to replay them and fail. The clean way to establish the
> tracking table is the full rebuild in §3: drop the D1, `pnpm db:migrate` into the empty
> database, then load data. From then on every deploy runs `pnpm db:migrate` incrementally.

---

## 3. Data Migration from Postgres

### Restore the dump to a local Postgres

```bash
createdb corvmc-migration
pg_restore -d corvmc-migration path/to/dump.Fc
```

### Run the migration script

```bash
# Dry run — shows what would be migrated without writing
DATABASE_URL="postgres://localhost/corvmc-migration" pnpm tsx scripts/migrate-from-postgres.ts

# Commit to local D1
DATABASE_URL="postgres://localhost/corvmc-migration" pnpm tsx scripts/migrate-from-postgres.ts --commit
```

The script only writes to **local** D1 (it uses `getPlatformProxy()`; the `--remote` flag
is intentionally unimplemented). To get the data into production: load locally, ensure
remote has a fresh schema (drop + `pnpm db:migrate`, see §2), then push the local data:

```bash
# 1. Export local data only (schema already exists on remote from `pnpm db:migrate`)
wrangler d1 export corvmc-db --local --no-schema --output ./d1-seed.sql

# 2. Reorder INSERTs parent-first — D1 enforces FKs on import and ignores the
#    PRAGMA defer_foreign_keys hint, so an unordered dump fails with a FK violation.
node scripts/reorder-seed.mjs        # writes d1-seed-ordered.sql

# 3. Import into remote
wrangler d1 execute corvmc-db --remote --file ./d1-seed-ordered.sql
```

> `scripts/reorder-seed.mjs` holds the table dependency order. If the schema gains a new
> table with foreign keys, add it to the `order` array in that file.

The script:

- Maps Laravel integer IDs to UUIDs (maintains a stable mapping file at `scripts/.id-map.json`)
- Transforms snake_case columns to the D1 schema
- Splits array columns into junction tables (instruments, genres)
- Merges `member_profiles` data into the `user` table
- Creates `account` records for better-auth credential storage
- Processes tables in foreign-key order

### Verify migration

```bash
# Check row counts
wrangler d1 execute corvmc-db --remote --command "SELECT 'user' as t, count(*) as n FROM user UNION ALL SELECT 'band', count(*) FROM band UNION ALL SELECT 'reservation', count(*) FROM reservation UNION ALL SELECT 'event', count(*) FROM event"
```

---

## 4. Pre-deploy Checks

```bash
pnpm check        # svelte-check — no type errors
pnpm lint         # ESLint + Prettier
pnpm test         # Vitest + Playwright
pnpm build        # Production build for Cloudflare Workers
```

---

## 5. Deploy

```bash
wrangler deploy
```

The deploy also registers the cron triggers from `wrangler.toml [triggers]` (propagation
can take up to 15 minutes). Verify under Workers & Pages → corvmc → Settings → Triggers
that the three schedules appear, and that subsequent cron events run clean (logs are
prefixed `[cron]`). `CRON_SECRET` must be set — it's part of the `wrangler secret bulk`
step — or every job returns `500 CRON_SECRET not configured`.

---

## 6. Stripe Webhook Setup

Create the webhook endpoint pointing to the new domain:

```bash
APP_URL=https://corvmc.com STRIPE_SECRET_KEY=sk_live_xxx pnpm tsx scripts/sync-webhooks.ts
```

The script outputs:

- `STRIPE_WEBHOOK_SECRET` — the signing secret
- `STRIPE_WEBHOOK_ID` — for future updates

Set the secret in production:

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste the secret from the script output
```

To update webhook events later:

```bash
STRIPE_WEBHOOK_ID=we_xxx STRIPE_SECRET_KEY=sk_live_xxx pnpm tsx scripts/sync-webhooks.ts
```

---

## 7. Custom Domain

In Cloudflare dashboard: Workers & Pages → corvmc → Settings → Domains & Routes → Add Custom Domain.

Or add to `wrangler.toml`:

```toml
routes = [
  { pattern = "corvmc.com", custom_domain = true }
]
```

Ensure the `ORIGIN` secret matches the domain exactly (including `https://`).

---

## 7a. Password Migration (bcrypt → scrypt)

bcrypt-ts silently fails on Cloudflare Workers (returns `false` in 0ms), so bcrypt passwords migrated from the Laravel app cannot be verified on the worker. A proxy flow handles this transparently:

1. SvelteKit detects a `$2y$` hash → calls `LARAVEL_URL/api/verify-password`
2. Laravel verifies bcrypt natively and returns `{ valid: true/false }`
3. On success, SvelteKit re-hashes with scrypt and updates D1
4. Future logins use scrypt directly — no more Laravel calls

**Secrets required on Cloudflare Pages:**

- `LARAVEL_URL` — base URL of the Laravel app (e.g. `https://corvmc.org`)
- `MIGRATION_SECRET` — shared secret matching `MIGRATION_SECRET` in Laravel's `.env`

**When cutting the domain to SvelteKit:**

1. Move the Laravel app to a subdomain (e.g. `legacy.corvmc.org`)
2. Update the Pages secret:
   ```bash
   npx wrangler pages secret put LARAVEL_URL --project-name corvmc <<< "https://legacy.corvmc.org"
   ```
3. Monitor logs for `[auth] bcrypt→scrypt migration complete` messages
4. Once no bcrypt hashes remain in D1, remove:
   - `LARAVEL_URL` and `MIGRATION_SECRET` secrets from Cloudflare Pages
   - The `verifyBcryptViaLaravel()` function and bcrypt branch in `src/lib/server/auth.ts`
   - The `/api/verify-password` route from the Laravel app
   - The Laravel app itself (if no longer needed)

**Check remaining bcrypt hashes:**

```sql
SELECT count(*) FROM account WHERE provider_id = 'credential' AND password LIKE '$2%';
```

---

## 8. Post-deploy Verification

- [ ] Site loads at production URL
- [ ] Sign in works for a migrated user
- [ ] Member dashboard shows correct data (reservations, bands, credits)
- [ ] Staff panel loads with correct permissions
- [ ] Create a test reservation (then cancel it)
- [ ] Trigger a Stripe test event: `stripe trigger payment_intent.succeeded --api-key sk_live_xxx`
- [ ] Check Cloudflare dashboard for worker errors

---

## 9. Subsequent Deploys

**Apply migrations to remote _before_ shipping the code that depends on them** — a deploy
whose code expects columns the remote D1 doesn't have yet is a production outage (this is
what broke `/directory`).

```bash
# If the schema changed, generate the migration and review the SQL it produced:
pnpm db:generate         # writes a new folder under migrations/

# Apply pending migrations to remote D1 (tracked, idempotent):
pnpm db:migrate          # run this BEFORE wrangler deploy

# Then:
pnpm check && pnpm lint && pnpm test
pnpm build
wrangler deploy
```

If you deploy via Cloudflare Workers Builds rather than `wrangler deploy` locally, run
`pnpm db:migrate` as part of the build/deploy command (it needs the three `CLOUDFLARE_*`
env vars set as build secrets) so schema can never lag behind code. This is automated —
see §9a.

---

## 9a. Migrations & data sync (pre-cutover)

While Postgres (DigitalOcean) is still canonical and D1 is staging: schema migrations are
applied automatically on deploy (A), and data is refreshed manually on demand (B).
**Both are temporary — remove at cutover (see §10a).**

### A. Schema migrate on every deploy (Cloudflare Workers Builds)

`scripts/ci-migrate.mjs` runs `drizzle-kit migrate` against remote D1, but only for a build
that publishes to production — `main`, or a `gh-readonly-queue/main/*` merge queue branch,
which Cloudflare builds and publishes in place of the `main` push (so PR/preview builds never
touch prod). Wire it into the deploy:

1. **Workers Builds → Settings → Build command:** `pnpm ci:migrate && pnpm build`
2. **Workers Builds → Build environment variables** (so `drizzle-kit migrate` can reach
   D1 over `d1-http`): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`,
   `CLOUDFLARE_D1_TOKEN` (a token scoped to **Account → D1 → Edit**).

If migrate fails, the build fails and nothing is published — schema can never lag code.

### B. Data refresh from Postgres (manual, from a trusted host)

Run on demand from a machine that is already a DO Postgres **Trusted Source** — your
laptop, or any box allowed to reach the cluster:

```bash
pnpm db:sync             # prompts before the destructive remote reload
pnpm db:sync -- --yes    # skip the prompt
```

`DATABASE_URL` is read from `.env` (or the shell env); append `?sslmode=require` for DO.
It reloads all data: ETL Postgres → local D1 → export → FK-order → clear remote (DELETE) →
import. No `pg_dump`; the ETL reads Postgres live over SSL. Requires wrangler auth
(`wrangler login`, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`). Your **local dev
D1 is preserved** (stashed and restored around the run). If you've added migrations since
the last deploy, run `pnpm db:migrate` first so the remote schema matches. The table
dependency order lives in `scripts/d1-table-order.mjs`; add any new FK-bearing table there.

> **Why not GitHub Actions / a cron?** The DO cluster also hosts other production
> databases, so it stays locked to Trusted Sources. GitHub-hosted runners have no static
> IP (their published ranges are large, volatile, and shared by all GitHub users), so they
> can't be safely allowlisted. Running from an already-trusted host avoids opening the
> cluster at all. If you later want this automated, the clean path is a self-hosted runner
> on a small Droplet in the DB's VPC, allowlisted as a Trusted Source and connecting over
> the private network.

### C. DigitalOcean Postgres connectivity

The cluster stays **locked** (it hosts other prod DBs). The sync host (your laptop) is
already a Trusted Source, so no firewall change is needed. Ensure `DATABASE_URL` ends with
`?sslmode=require` (DO requires SSL).

---

## 10. Rollback

```bash
# Revert to previous Worker version
wrangler rollback
```

D1 migrations cannot be auto-reversed. If a migration needs to be undone:

1. Write a new forward migration that reverses the changes (edit the schema, then
   `pnpm db:generate`, or hand-author a folder under `migrations/`)
2. Apply it to remote: `pnpm db:migrate`

For emergency data fixes:

```bash
wrangler d1 execute corvmc-db --remote --command "UPDATE user SET ..."
```

---

## 10a. Cutover teardown

When D1 becomes canonical (Postgres retired), the §9a data sync is no longer wanted:

- Delete the `sync-d1.sh` / `migrate-from-postgres.ts` / `reorder-seed.mjs` /
  `gen-d1-delete.mjs` / `d1-table-order.mjs` data-sync scripts.
- Decommission the DO Postgres database.
- Retire the bcrypt→scrypt Laravel proxy per §7a.

Keep §9a part A (`pnpm ci:migrate` in the build command) — applying migrations before
publish is still correct post-cutover.

---

## Drizzle Kit Remote Access

For running `drizzle-kit studio` or other Drizzle Kit commands against production:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_DATABASE_ID="your-d1-database-id"
export CLOUDFLARE_D1_TOKEN="your-api-token-with-d1-edit"

pnpm drizzle-kit studio
```

Create the API token at: Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom → Permissions: Account / D1 / Edit.
