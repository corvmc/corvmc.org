---
paths:
  - 'src/lib/server/db/**'
  - 'migrations/**'
  - 'drizzle.config.ts'
---

# Schema and migrations

- **`db.transaction()` does not work on D1.** Use `db.batch([...])` for atomic writes. ESLint
  errors on the former across `src/lib/server/**`.
- **Schema files import config by relative path** (`from '../../../config'`), not `$lib/config` —
  `drizzle-kit` runs them through jiti, which has no alias map, so an aliased import breaks
  `pnpm db:generate`.
- **Chunk bulk inserts.** D1 caps a single statement at 100 bound parameters, so a multi-row
  drizzle insert in a seed or fixture has to be split.

## Generating a migration

`pnpm db:generate` runs `drizzle-kit generate`, then `scripts/db/d1-safe-rebuild.mjs`, which
rewrites unsafe table rebuilds, then `scripts/db/prune-snapshots.mjs`, which deletes the
snapshots nothing will read again. Details and the reasoning are in
`docs/development/conventions.md#table-rebuilds-on-d1` and
`docs/development/conventions.md#snapshots-are-pruned`.

- **Review the rewritten SQL.** It is longer than drizzle's output and rebuilds tables your change
  never mentioned — those are the cascade children, and that is correct.
- **Never edit a committed migration.** Fix a new one with `pnpm db:fix-migrations`.
- **After merging `main`, run `pnpm exec drizzle-kit check` and believe it.** Snapshots carry
  `prevIds` — plural — so a fork is legal and `generate` merges it by itself. Exit 0 means change
  nothing. Only a non-zero exit calls for collapsing this branch's own migrations, and only ever
  through `pnpm db:generate`, never by hand. See
  `docs/development/conventions.md#long-lived-feature-branches`.
- **Never delete a migration that exists on `origin/main`.** It has run in production and no later
  migration can put it back. `scripts/claude/block-shipped-migration-delete.sh` enforces this.
- **`pnpm db:reset`, not `db:migrate:local`, after a merge from `main`.** Migrations are selected by
  name with no timestamp watermark, so an incremental run applies main's older migrations after
  yours and builds an order nothing else has.
- **Only the newest migration keeps a snapshot**, plus anything not yet on `origin/main`.
  `generate` reads exactly one snapshot as its diff base, `migrate` reads none, and `check`
  tolerates an absent parent — so the other 60-odd were 12MB of never-read JSON. Nothing to do
  by hand; `db:generate` prunes. A migration on `origin/main` that turns up _without_ a snapshot
  is normal and `db:check-migrations` says how many it skipped.
- **A table can go missing from the schema _and_ the snapshot at once**, which is invisible to
  `generate` — that is how `product_config` survived three months in production with nothing
  declaring it. `scripts/migration-replay.spec.ts` replays the SQL and compares, so this now
  fails the unit suite. Fixing one needs `drizzle-kit generate --custom` to carry the `DROP`,
  since `generate` has nothing left to diff.
- An intentional drop of a table with FK children needs the marker comment
  `-- d1-safe-rebuild: intentional drop \`table\``or`pnpm db:check-migrations` fails.
- Verify anything touching a table with children: `pnpm db:reset`, then check row
  counts in the child tables.

CI's **Schema drift** job runs `drizzle-kit check`, regenerates, fails on a dirty tree, and then
runs `pnpm db:check-migrations`.
