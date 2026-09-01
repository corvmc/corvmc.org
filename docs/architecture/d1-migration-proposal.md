# Proposal: Migrate from PostgreSQL to Cloudflare D1

> **📦 Shipped — kept for the reasoning, not as a runbook.** Option 2 was taken and D1 is now the
> production database. **Do not follow the migration steps below.** D1 is canonical; the Postgres
> instance stopped being so long ago, and every tool that moved data from it — `pnpm db:sync`,
> `scripts/migrate-from-postgres.ts` and the rest of the ETL — has been deleted precisely because
> keeping them meant keeping a documented way to overwrite production with a stale snapshot. The
> last three scripts that read `DATABASE_URL` went too. There is no supported path from Postgres
> any more; write against the current schema instead.
>
> What survives here is the decision: why D1 over Hyperdrive, and which Postgres features had to
> be given up. Live operations are in [operations-manual.md](operations-manual.md) §6.

## Context

CorvMC currently runs on PostgreSQL via Drizzle ORM with the `postgres` npm package. If we deploy to Cloudflare Workers (per the universal data layer proposal), we need a database strategy. The options are:

1. **Hyperdrive** — Cloudflare's connection proxy to an external Postgres. Zero code changes, but adds a managed dependency and latency to a remote DB.
2. **D1** — Cloudflare's native SQLite-at-the-edge database. Co-located with Workers, no connection management, but requires a schema and query migration.

This proposal covers option 2: what it takes to move to D1.

## What works as-is

Most of the schema and query layer translates cleanly:

- **Drizzle ORM** supports SQLite/D1 natively (`drizzle-orm/d1`)
- **CHECK constraints** — supported in SQLite 3.30+
- **Partial indexes** (WHERE clauses on indexes) — supported in SQLite 3.30+
- **CASE, COALESCE in queries** — standard SQL, works unchanged
- **All service-layer business logic** — unchanged, only the DB driver and schema definitions change
- **17 existing migrations** — discarded and regenerated from the new SQLite schema (clean slate since the project is 7 days old)

## What needs to change

### 1. Schema definitions: `pgTable` → `sqliteTable`

Every schema file (13 files) uses `pgTable`. These become `sqliteTable` with SQLite column types.

| Postgres                   | SQLite equivalent                                                 | Files affected             |
| -------------------------- | ----------------------------------------------------------------- | -------------------------- |
| `pgTable`                  | `sqliteTable`                                                     | all 13 schema files        |
| `uuid().defaultRandom()`   | `text().primaryKey().$defaultFn(() => crypto.randomUUID())`       | 15+ tables                 |
| `bigserial` / `serial`     | `integer({ mode: 'number' }).primaryKey({ autoIncrement: true })` | 3 tables                   |
| `timestamp().defaultNow()` | `text().default(sql\`(current_timestamp)\`)`                      | widespread                 |
| `jsonb()`                  | `text({ mode: 'json' })`                                          | 10 columns across 5 tables |
| `text('col').array()`      | see "Array columns" below                                         | 3 columns                  |

Effort: mechanical find-and-replace per file, ~1 day.

### 2. Array columns → junction tables

Three columns use PostgreSQL `text[]` arrays with GIN indexes and the `&&` (overlap) operator:

- `user.instruments` — e.g. `['guitar', 'drums']`
- `user.genres` — e.g. `['rock', 'jazz']`
- `band.genres` — e.g. `['punk', 'metal']`

**Current queries** (in `directory-service.ts`):

- Array overlap: `WHERE instruments && ARRAY['guitar','bass']::text[]`
- Distinct values: `SELECT DISTINCT unnest(instruments) FROM "user"`

**Migration**: Create junction tables:

```
user_instrument (user_id TEXT, instrument TEXT, PRIMARY KEY(user_id, instrument))
user_genre      (user_id TEXT, genre TEXT, PRIMARY KEY(user_id, genre))
band_genre      (band_id TEXT, genre TEXT, PRIMARY KEY(band_id, genre))
```

Overlap queries become `WHERE EXISTS (SELECT 1 FROM user_instrument WHERE ...)`. The `unnest` queries become `SELECT DISTINCT instrument FROM user_instrument`.

GIN indexes are replaced by the junction table's primary key index.

Effort: 3 new tables, rewrite 5 queries in `directory-service.ts`, update seed data. ~0.5 day.

### 3. JSONB operations → column extraction or app-layer JSON

Two categories:

**a) Simple JSONB storage** (settings, directoryContact, links, notification data, creditTransaction metadata) — these are just stored and retrieved whole, never queried with JSON operators. Drizzle's `text({ mode: 'json' })` handles serialization/deserialization transparently. **No query changes needed.**

**b) Atomic JSONB mutations** (credit-service.ts) — this is the hard one. Three functions use:

- `jsonb_set()` to update a nested value
- `->>` to extract and cast
- `::int` for type casting
- `FOR UPDATE` for row-level locking

```sql
-- Current: atomic credit deduction in Postgres
UPDATE "user"
SET credits = jsonb_set(credits, '{free_hours}', to_jsonb((credits->>'free_hours')::int - 5))
WHERE id = $1 AND (credits->>'free_hours')::int >= 5
RETURNING (credits->>'free_hours')::int AS new_balance
```

**Migration options**:

**Option A — Extract credits to columns** (recommended):
Add `credit_free_hours INTEGER DEFAULT 0` and `credit_equipment INTEGER DEFAULT 0` directly on the `user` table. The atomic update becomes:

```sql
UPDATE user SET credit_free_hours = credit_free_hours - 5
WHERE id = ? AND credit_free_hours >= 5
```

Simple, no JSON parsing, naturally atomic in SQLite's serialized write model.

**Option B — App-layer JSON**: Read the JSON string, parse in JS, modify, write back. Loses atomicity — concurrent requests could race. Not recommended for credits.

Effort: add 2 columns to user table, rewrite 3 functions in `credit-service.ts`. ~0.5 day.

### 4. `FOR UPDATE` row locking → removed

SQLite uses database-level locking, not row-level. D1 serializes writes automatically. The `SELECT ... FOR UPDATE` statements in `credit-service.ts` can be removed — SQLite transactions already guarantee isolation for the write patterns used here.

Effort: delete 3 lines. Minutes.

### 5. Database client swap

```ts
// Before
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
const client = postgres(env.DATABASE_URL);
export const db = drizzle(client, { schema });

// After (D1 in Workers)
import { drizzle } from 'drizzle-orm/d1';
export const db = (d1: D1Database) => drizzle(d1, { schema });
```

The D1 binding comes from the Workers runtime (`env.DB`), passed through SvelteKit's platform object.

Effort: ~20 lines changed in `src/lib/server/db/index.ts` + adapter config.

### 6. Drizzle config

```ts
// Before
{ dialect: 'postgresql', dbCredentials: { url: process.env.DATABASE_URL } }

// After
{ dialect: 'sqlite', driver: 'd1-http', dbCredentials: { ... } }
```

### 7. Migrations

The 17 existing Postgres migrations are discarded. Run `drizzle-kit generate` against the new SQLite schema to produce a fresh initial migration. This is fine — the project is 7 days old with no production data.

## What this enables

- **Edge deployment**: D1 is co-located with Workers. No connection pooling, no Hyperdrive dependency, sub-millisecond DB access.
- **Zero cold-start DB cost**: No TCP handshake to a remote Postgres on each request.
- **Simplified infra**: One platform (Cloudflare) for compute, database, storage (R2), and cron (Workers Cron Triggers).
- **Local dev**: D1 has a local SQLite mode via `wrangler dev` that works offline.

## Trade-offs vs Hyperdrive + Postgres

|                      | D1 (SQLite)                | Hyperdrive (Postgres)      |
| -------------------- | -------------------------- | -------------------------- |
| **Code changes**     | ~2 days of migration       | ~0 (just config)           |
| **Latency**          | Co-located, sub-ms         | Remote DB, 10-50ms         |
| **Concurrency**      | Single-writer (serialized) | Full MVCC                  |
| **Max DB size**      | 10 GB per database         | Unlimited                  |
| **JSON operations**  | Basic (json_extract)       | Full JSONB                 |
| **Full-text search** | SQLite FTS5 (good)         | Postgres tsvector (better) |
| **Vendor lock-in**   | Cloudflare D1              | Any Postgres host          |
| **Local dev**        | wrangler dev (offline)     | Needs running Postgres     |

The main risk is **write concurrency**. D1 serializes all writes to a single database. For CorvMC's expected load (community music space, not high-traffic SaaS), this is unlikely to be a bottleneck. If it ever becomes one, D1 supports read replicas.

## Execution order

1. **Swap schema definitions** — `pgTable` → `sqliteTable`, column types, remove GIN indexes (all 13 schema files)
2. **Add junction tables** for instruments/genres (3 new tables)
3. **Extract credits to columns** on user table, rewrite `credit-service.ts`
4. **Remove `FOR UPDATE`** statements
5. **Rewrite directory-service.ts** queries (array overlap → junction table joins, unnest → distinct select)
6. **Update DB client** — `postgres-js` → `d1`, update `db/index.ts`
7. **Update drizzle config** — dialect, driver
8. **Generate fresh migration** — `drizzle-kit generate`
9. **Update seed script** — populate junction tables
10. **Test locally** with `wrangler dev`

## Estimated effort

~2 days. The schema swap is mechanical, the credit extraction is small, and the directory queries are the only real rewrite. No business logic changes.

## Recommendation

If the plan is to deploy on Cloudflare Workers, D1 is the cleaner long-term choice — simpler infra, better latency, no connection management. The migration cost is low because the project is young. Hyperdrive is the safer short-term choice if you want to defer the migration and ship to Workers faster.

These two proposals (universal data layer + D1) are independent and can be done in either order. The universal data layer is higher priority since it unblocks the kiosk app regardless of database choice.
