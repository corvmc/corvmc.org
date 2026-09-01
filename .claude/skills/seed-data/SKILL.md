---
name: seed-data
description: Write or extend seeded data for this repo — the dev seed in scripts/seed-dev.ts, named demo personas with working logins, and e2e fixtures. Use when a feature needs local data, when a surface renders empty in dev, when a screen or state cannot be reached without a second account, or when asked to add demo/test/sample data.
---

# Seeding

Three separate systems, and using the wrong one is the usual mistake:

| Where                             | Used by                        | Shape                                                            |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `scripts/seed-dev.ts`             | `pnpm db:reset` / `db:seed`    | The whole lived-in dev database. Destructive; wipes first        |
| `e2e/fixtures/seed-<area>.ts`     | `e2e/prepare.ts`               | Small, deterministic, per-suite. **Never loads `seed-dev.ts`**   |
| `scripts/seed-volunteer-roles.ts` | run by hand against production | Additive, dry-run by default. A catalog bootstrap, not a fixture |

`docs/development/conventions.md` already says **when** — with the schema, in the same
change, because every surface built before the rows exist is reviewed against the zero case.
This is **how**.

## The shape of a seeder

One `seedX()` appended at the end of `scripts/seed-dev.ts`, one line in `main()`, one line in
the console summary. One insertion point per feature, not one per phase — `main()` and
`deleteAll()` are the file's two hot spots and every concurrent branch touches them.

`main()` order is a dependency graph, not a style choice: a seeder can only read what already
ran. Put a new one where its inputs are available and say in a comment what it needs.

## Four mechanics that bite

- **It runs under `tsx`, so SvelteKit aliases do not resolve.** No `$lib`, no `$env`, no
  `$app` — import by relative path (`../src/lib/config`), and do not import a module that
  pulls those transitively. `src/lib/server/auth.ts` is why `scryptHash` is reproduced inline
  at the top of the file rather than imported.
- **D1 caps a statement at 100 bound parameters.** `batchInsert(table, rows, batchSize)`
  defaults to 10, so anything past 10 columns overflows. Do the arithmetic and put it in a
  comment the way the neighbours do: _13 columns × the default 10 is 130, over the ceiling;
  7 × 13 = 91_.
- **A new table must be added to `scripts/d1-table-order.mjs`**, after everything it
  references. `deleteAll()` derives the wipe from that list, and
  `scripts/seed-dev-wipe.spec.ts` fails if a table name is hand-written into `deleteAll`
  instead. A missing entry does not error — the rows survive the wipe and the _second_ seed
  dies on a unique constraint that names the table and nothing else.
- **Foreign keys are off for the whole run** (`PRAGMA foreign_keys = OFF`), so a wrong id
  inserts happily and only surfaces as an empty join on a page. There is no
  `db.transaction()` on D1; use `db.batch([...])` or sequential inserts.

## What to seed

Conventions covers the baseline: every value each enum allows, including the awkward ones.
The harder rule is the one that only shows up when somebody tries to look at a screen:

**Hunt the states that are structurally unreachable.** A card whose query can never match on
any seed is indistinguishable from a card that is merely quiet. Before calling a feature
seeded, check for:

- A join condition no seeded row can satisfy — the volunteer lapsing-clearance card needed a
  grant with an expiry, for a certification some role required, held by somebody rostered on
  a shift for it, and the only requirement in the catalog never expired.
- Terminal states nothing writes: cancelled, revoked, no-show, returned, archived.
- A nullable foreign key that is always null, so the relationship never renders.
- Lists that fill to capacity, leaving nothing actionable.
- A page whose default filter is a date range the seeded rows fall outside.

Anchor dates that represent a **calendar day** at noon club time (`ptDate(-daysAgo, 12)`).
Midnight local is the previous UTC day in any UTC-ahead zone, and reports bucket by
`strftime` over the stored instant.

Keep problem states off the front of the users array. `seedUserRoles` gives `users[0]`–
`users[1]` admin+staff and `users[2]`–`users[4]` staff, so filing them in a needs-review
queue puts the site's own operators there and reads as a bug.

## Personas

A named account with a working login. Add them when a state cannot be reached any other way —
a funnel gated on a stage, where the stages are mutually exclusive per user, needs one account
per stage — or when the staff view should be somebody's job rather than the admin's.
`scripts/seed-dev.ts`'s `seedVolunteerPersonas` is the worked example.

Rules, all of which have already caused a bug:

- **Keep them out of `allUsers`.** `seedVolunteerProfiles` slices that array (`users.slice(-2)`)
  and `seedUserRoles` indexes into it; appending silently reassigns both. Staying out also
  keeps random `pickN` holders from colliding with a persona's deliberately-shaped rows.
- **No randomness.** Literal ids, statuses, minute counts and day offsets, all computed from a
  single `const now = new Date()`. A persona is what a screenshot, a demo or a bug report gets
  pointed at by name; if it varies per run it is not one.
- **The login is an `account` row**, mirroring `seedAdminUser()`: `accountId = userId`,
  `providerId: 'credential'`, `password: await scryptHash('password')` hashed **per persona**
  so each carries its own salt, `issuer` left to its column default. better-auth ≥ 1.7 matches
  on `issuer`; a row without one reports "User not found", the same message a bad email gets.
- **`memberNumber` is uniquely indexed.** The generated users take 100+; pick a free block.
- **Print them.** Add the logins, and any deep link only they can reach, to the seed's closing
  summary — then fix any doc that claims the seed creates one password account
  (`docs/development/local-dev-quickstart.md`, `README.md`).

Personas seeded outside `allUsers` get no `directory_entry`, because that seeder has already
run by then. Harmless today — the member lookups left-join — but check before relying on it.

## Verify

`pnpm db:reset`, then `pnpm db:seed` **again** — the second seed is what proves the wipe
covers your tables, and it is not the same test as `db:reset` twice, which deletes the D1
files outright and never exercises `deleteAll()` against existing rows. Read the console
summary, then open the surfaces the rows are for and confirm each state actually renders; a
count in the summary is not evidence that a page shows it. Then
`pnpm test:unit -- --run` (`scripts/seed-dev-wipe.spec.ts` and
`scripts/d1-table-order.spec.ts` are the ones a new table breaks) and `pnpm lint`.

E2E is unaffected — `e2e/prepare.ts` builds its own state directory from `e2e/fixtures/` and
never loads the dev seed — so a dev-seed change does not need an e2e run to justify itself.
