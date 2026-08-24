# Codebase Conventions

The rules this codebase follows — some enforced by tooling, some by discipline. This is the
human-maintained companion to [ui-patterns.md](ui-patterns.md) (read that before touching
any page) and the [architecture overview](../architecture/overview.md).

## The feature checklist

When building a new feature, work through these phases in order:

1. **Design** — understand the domain and map the workflows before proposing models. For
   anything that touches multiple files or introduces schema, write a spec in
   `docs/specs/` first. `docs/specs/shipped/` holds specs for features that already
   exist — good templates, and the place to check whether the thing you are designing has
   been argued about before.
2. **Schema** — add columns/tables in `src/lib/server/db/schema/`, then generate the
   migration yourself with `pnpm db:generate` and **review the SQL** before committing.
   Add shared types to `src/lib/types/` if the feature introduces new structures (JSONB
   shapes, enums). If the migration rebuilds a table, read
   [table rebuilds on D1](#table-rebuilds-on-d1) below.
3. **Services** — server logic in `src/lib/server/<domain>/`. Keep query functions and
   mutation functions separated. Validate inputs in the service layer with explicit limits
   (max lengths, max item counts).
4. **Routes & UI** — build pages using [ui-patterns.md](ui-patterns.md). Data access via
   remote functions (`query()`/`form()` in `src/lib/remote/`). Add nav links in the
   relevant layout (member / band / staff).
5. **Seed data** — extend `scripts/seed-dev.ts` so the feature has realistic local data.
   Use pools of sample values and randomized assignment for domain-specific fields.
6. **Tests** — write tests that describe **intended behavior**, not the current
   implementation. Service-level mocks where direct DB access isn't practical. A failing
   test that reflects unfinished business logic is acceptable.
7. **Verify** — `pnpm check` and confirm no new type errors in files you touched
   (pre-existing errors in unrelated files can be ignored).
8. **Document** — add the feature row to `docs/reports/parity-report.md`; update/add help
   articles and run the docs checks (see
   [Docs workflow](#docs-workflow-when-you-change-routes-or-help-content) below). If the
   feature had a spec, **retire it now** — see below.
9. **Commit** — descriptive message summarizing what the feature adds. **No co-author
   lines.**

### Retiring a spec

A spec describes what you intend to build. The moment it is built, it describes live
behavior instead — and a document that describes live behavior with a spec's authority is
how a doc folder starts lying, because nothing makes anyone update it. `docs/specs/` held
23 such files before [reports/spec-audit.md](../reports/spec-audit.md) sorted them out, and
three of them asserted a feature was unbuilt that had shipped months earlier.

So when a feature lands, do three things in the same PR:

1. **Write the behavior where behavior lives** — a section in
   [business-workflows.md](business-workflows.md) for anything with a code path worth
   tracing, and help articles for anything a member or staffer touches. The workflow
   sections all follow one shape: the story, the code path, data touched, where it breaks.
2. **Move the spec to `docs/specs/shipped/`** and fix the links that pointed at it. What
   survives there is the design rationale — the options weighed and rejected — which is the
   half no manual article ever carries.
3. **If only part of it shipped, split it.** `specs/reservation-confirmation-window.md` is
   the worked example: the shipped phases became prose in business-workflows §1 and the file
   was rewritten down to the one phase that was never built.

Nothing enforces this. It is the last thing anyone feels like doing and the first thing that
rots, which is exactly why it is written down.

## Table rebuilds on D1

Some schema changes can't be expressed as `ALTER TABLE` — relaxing `NOT NULL`, changing a
foreign-key action, adding a check. For those, drizzle-kit emits a **table rebuild**:
create `__new_x`, copy the rows, `DROP TABLE x`, rename. It wraps that in
`PRAGMA foreign_keys=OFF` so the drop doesn't cascade.

**That pragma does nothing on D1.** D1 runs each migration inside a transaction, and
SQLite treats `PRAGMA foreign_keys` as a no-op inside one — the statement succeeds and the
value never changes (it reads back `1` immediately after being set to `OFF`). So
`DROP TABLE x` performs its implicit delete: every `ON DELETE CASCADE` child loses its
rows and every `ON DELETE SET NULL` child is nulled, silently and without an error.

No pragma avoids this. `defer_foreign_keys` delays _reporting of violations_ but doesn't
stop FK _actions_; `legacy_alter_table` does register on D1, but preserving child
references through a rename also needs `foreign_keys=OFF`. This is
[drizzle-orm#4089](https://github.com/drizzle-team/drizzle-orm/issues/4089), open with no
fix, so assume it stays.

**You don't need to do anything special** — `pnpm db:generate` runs
`scripts/db/d1-safe-rebuild.mjs`, which rewrites an unsafe rebuild into
detach → rebuild → reattach: each cascade child is rebuilt with its FK demoted to
`NO ACTION` (deepest descendants first), then the real table is rebuilt, then the children
are restored with their actions intact. `defer_foreign_keys` holds the transient violation
until commit.

What this means in practice:

- **Review the rewritten SQL.** It's longer than drizzle's output and rebuilds tables your
  change didn't mention. That's expected — those are the cascade children.
- **CI enforces it.** `pnpm db:check-migrations` runs in the Schema drift job and fails on
  an unsafe rebuild — one generated with plain `drizzle-kit generate`, or hand-written.
- **Dropping a parent table is also caught.** Any `DROP TABLE` on a table with foreign-key
  children fails the check, since it cascades the same way. If you really are removing the
  table for good, say so in the migration and the check will allow it:

  ```sql
  -- d1-safe-rebuild: intentional drop `band`
  ```

- **Never edit an applied migration.** The three pre-existing rebuilds are grandfathered in
  the script; that list is closed. Fix a new migration with `pnpm db:fix-migrations`.
- **Verify against local D1** for anything touching a table with children:
  `pnpm db:reset && pnpm db:seed`, then check row counts in the child tables.

## Layering rules

```
+page.svelte → src/lib/remote/*.remote.ts → src/lib/server/<domain>/ → db
```

- Components never import from `$lib/server/` directly; they call remote functions.
- Every remote function starts with a **guard** (`requireUser`, `requireStaff`,
  `requireBandMember`, `requireFeature`, ...) and validates its input with a **Zod
  schema**. A guard in the layout is not a guard on the data — the remote function is the
  security boundary.
- Business logic lives in services; remotes are thin (guard + validate + orchestrate).
- Services throw typed domain errors; remotes map them via `mapDomainError()`
  (`src/lib/server/errors.ts`).
- Prefer DTO-shaped return values over passing raw rows to the UI; never return
  string-indexed grab-bag objects from services.
- Side effects (emails, notifications, cascades) go through the event bus
  (`src/lib/server/events/`) and must be idempotent.

## Forms: no raw elements

Every form in a route file uses the shared components from
`$lib/components/shared/Form/` — `Form`, `FormField`, `SubmitButton` — never raw `<form>`,
`<input>`, or `<select>` elements, even for small inline forms. Mutations use `form()` from
`$app/server` in a `.remote.ts` file so `<Form>` wires up validation and dirty tracking
automatically. Full patterns and component API: [ui-patterns.md](ui-patterns.md).

## Custom ESLint rules

Three project-specific rules live in `eslint-rules/` and are registered once as the
`custom` plugin in `eslint.config.js` (note the comment there: registering the plugin in
more than one config object crashes eslint with "Cannot redefine plugin custom").

| Rule                              | Severity / scope                                        | What it flags → what to do instead                                                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom/no-db-transaction`        | **error** on `src/lib/server/**/*.ts` (excluding specs) | Any `.transaction()` call — broken on D1. Use `db.batch([...queries])` for atomic writes.                                                                                                                                                                                                                     |
| `custom/no-raw-form-elements`     | **warn** on `+page.svelte` files                        | Raw `<form>` elements in pages. Use the `<Form>` component.                                                                                                                                                                                                                                                   |
| `custom/no-utility-soup`          | **warn** on `+page.svelte` files                        | Hand-written utility-class soup where a component or semantic utility exists: >5 classes on one element, a raw `btn`/`card`/`badge`/`alert`/`stat`/`table`, the dead `*-bordered` classes, `text-sm opacity-60` instead of `text-muted`, or an inline `style` reaching a `var(--…)`. See `template-audit.md`. |
| `custom/no-duplicate-field-names` | **error** on all `*.svelte`                             | Two fields submitting the same `name` within one `<Form>` (statically resolvable names only) — the later value silently wins on submit. Rename one.                                                                                                                                                           |

Other lint posture (see `eslint.config.js`): `no-explicit-any` and
`svelte/no-navigation-without-resolve` are downgraded to warnings; unused vars error unless
prefixed with `_`.

## Git hooks

Installed by `pnpm install` (via `prepare` → `lefthook install`), defined in `lefthook.yml`:

- **pre-commit** — prettier `--write` and eslint `--fix` on staged files, auto-restaged.
  Warn-only: it fixes what it can and never blocks the commit.
- **pre-push** — `pnpm check || true`: prints type errors as a heads-up but doesn't block.

The blocking gates are in CI, not the hooks.

## Style

- Interfaces/UI: **no gradients**.
- Match the surrounding code's comment density, naming, and idioms. Comments state
  constraints the code can't show — this codebase does that well (see
  `src/lib/server/auth.ts` or `reservation-service.ts` for the house style).
- Prettier (with the svelte + tailwind plugins) is the formatter; don't hand-format.

## pnpm script reference

Every script in `package.json`:

| Script                          | What it does                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`                           | Vite dev server on :5173 (a worktree gets its own port — `scripts/lib/checkout-ports.ts`)                                                                             |
| `build`                         | `vite build` (output: `.svelte-kit/cloudflare/`)                                                                                                                      |
| `preview`                       | Serve the production build on :4173 (a worktree gets its own port)                                                                                                    |
| `prepare`                       | (auto on install) svelte-kit sync + lefthook install                                                                                                                  |
| `check` / `check:watch`         | svelte-check type checking                                                                                                                                            |
| `test:unit`                     | Vitest (watch mode; `--run` for one-shot)                                                                                                                             |
| `test:components`               | One-shot client (browser) + storybook vitest projects                                                                                                                 |
| `test:e2e`                      | Install Chromium + run Playwright `e2e/**/*.e2e.ts`                                                                                                                   |
| `test`                          | Full suite: unit one-shot + e2e (what CI runs)                                                                                                                        |
| `test:report`                   | Vitest with JSON output → `test-results.json`                                                                                                                         |
| `lint`                          | prettier `--check` + eslint over everything                                                                                                                           |
| `lint:changed`                  | Lint only files changed vs `origin/main` (`scripts/lint-changed.sh`; PR CI uses this)                                                                                 |
| `format`                        | prettier `--write` everything                                                                                                                                         |
| `db:generate`                   | drizzle-kit: generate a migration from schema changes, then make any table rebuild D1-safe                                                                            |
| `db:fix-migrations`             | Rewrite unsafe table rebuilds (run automatically by `db:generate`)                                                                                                    |
| `db:check-migrations`           | Fail if any migration has an unsafe table rebuild (runs in CI)                                                                                                        |
| `db:migrate`                    | drizzle-kit: apply pending migrations to **remote** D1                                                                                                                |
| `db:migrate:local`              | Replay all migration files into the local D1                                                                                                                          |
| `db:seed`                       | Run `scripts/seed-dev.ts` against local D1                                                                                                                            |
| `volunteer:seed-roles`          | Seed the volunteer role catalogue (`scripts/seed-volunteer-roles.ts`)                                                                                                 |
| `db:reset`                      | Wipe local D1 + migrate + seed                                                                                                                                        |
| `db:studio`                     | drizzle-kit studio GUI (**remote** D1 — needs `CLOUDFLARE_*` vars)                                                                                                    |
| `db:sync`                       | Pre-cutover: reload remote D1 data from Postgres (destructive — see [operations manual](../architecture/operations-manual.md#6-the-postgres-bridge-pre-cutover-only)) |
| `ci:migrate`                    | Remote migrate, but only on `main` (used by Cloudflare Workers Builds)                                                                                                |
| `storybook` / `build-storybook` | Storybook on :6006 / static build                                                                                                                                     |
| `stripe:sync-webhooks`          | Sync the Stripe webhook endpoint's event list to the code registry                                                                                                    |
| `help:sync`                     | Upsert `src/content/help/**` articles into the D1 help tables                                                                                                         |
| `docs:routes`                   | Regenerate the route snapshot `docs/manual/route-inventory.json`                                                                                                      |
| `docs:check`                    | Docs integrity + route-drift check (CI gate)                                                                                                                          |
| `email:push` / `email:pull`     | Sync Postmark transactional templates repo ↔ Postmark                                                                                                                 |
| `email:preview`                 | Render the templates to `.email-preview/` for eyeballing                                                                                                              |
| `email:validate`                | Check template syntax and required variables                                                                                                                          |

## Docs workflow (when you change routes or help content)

Before opening a PR that adds/removes/moves a route or touches help articles:

1. Update or add the help article(s) in `src/content/help/` and the manifest in
   `docs/manual/README.md`.
2. `pnpm docs:routes` — regenerate and commit `docs/manual/route-inventory.json`.
3. `pnpm docs:check` — must pass; CI fails the PR on integrity errors.
4. New feature shipped? Add its row to `docs/reports/parity-report.md` (checklist phase 8)
   and index any new doc in `docs/README.md`.

Keeping the docs honest is a manual step in every PR that changes behaviour — nothing
watches for drift on your behalf. The full procedure is in the
[operations manual §7](../architecture/operations-manual.md#7-keeping-the-docs-healthy).

## Working with Claude Code

Agent-facing instructions are split by cost: `CLAUDE.md` (always loaded), `.claude/rules/`
(path-scoped), `.claude/skills/` (on demand), and two `PreToolUse` hooks in `scripts/claude/` that
block `npm`/`npx` and edits to committed migrations. The reasoning, and where a new rule belongs,
is in [working-with-claude.md](working-with-claude.md).

## Dependency posture

Prefer existing libraries and managed services over new bespoke code — the goal is to
minimize _maintained_ code, not just initial build effort. Lean on Stripe, Postmark, and
Cloudflare primitives rather than re-creating vendor features in app code. When adding a
dependency, note it in `IDEAS.md`'s library table if it's broadly useful.

## Where a status enum lives

Two homes, and the split is deliberate:

- **`src/lib/config.ts`** — enums that client code (routes, components) imports.
- **`src/lib/server/db/schema/*.ts`** — enums only server code needs.

The constraint is bundling, not taste: `$lib/server` cannot be imported from the browser, so an
enum a `.svelte` file needs _cannot_ live in a schema file. Schema files import the client-side
enums from `config.ts` when they need to build a column constraint, which is why the dependency
runs config → schema and never the other way.

If you see a schema-defined enum with what looks like a client importer, check the file: spec files
run in the **server** vitest project, where `$lib/server` is reachable. `StatusBadge.spec.ts` is the
example that makes the split look inconsistent when it isn't.

Label and colour maps for these values live in `StatusBadge.svelte` (`labels`, `badgeClass`,
`variants`), and `StatusBadge.spec.ts` asserts every enum value is covered. Domain-specific wording
— "Waiting on DNS" rather than a generic "Pending" — belongs at the call site, not in the shared
registry.
