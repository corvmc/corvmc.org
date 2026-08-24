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

`pnpm db:generate` runs `drizzle-kit generate` and then `scripts/db/d1-safe-rebuild.mjs`, which
rewrites unsafe table rebuilds. Details and the reasoning are in
`docs/development/conventions.md#table-rebuilds-on-d1`.

- **Review the rewritten SQL.** It is longer than drizzle's output and rebuilds tables your change
  never mentioned — those are the cascade children, and that is correct.
- **Never edit a committed migration.** Fix a new one with `pnpm db:fix-migrations`.
- **Regenerate after merging `main`.** A sibling PR whose migration carries an earlier timestamp
  invalidates your snapshot; always regenerate through `pnpm db:generate`, never by hand.
- An intentional drop of a table with FK children needs the marker comment
  `-- d1-safe-rebuild: intentional drop \`table\``or`pnpm db:check-migrations` fails.
- Verify anything touching a table with children: `pnpm db:reset && pnpm db:seed`, then check row
  counts in the child tables.

CI's **Schema drift** job runs `drizzle-kit check`, regenerates, fails on a dirty tree, and then
runs `pnpm db:check-migrations`.
