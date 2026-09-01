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

   **Extend `scripts/seed-dev.ts` in the same change.** Every surface built between the
   schema landing and the seed being written is developed and reviewed against _no rows_ —
   a staff queue, an empty state, a listing all render the zero case and nothing else, and
   the browser-preview step cannot verify anything until the end, which is when it is least
   useful. Cover each value the enums allow, including the awkward ones: a returned
   application, a paused grant, a record excluded for two different reasons. Those are the
   screens that otherwise only ever get looked at empty, and empty is the case that is
   already obviously right.

3. **Services** — server logic in `src/lib/server/<domain>/`. Keep query functions and
   mutation functions separated. Validate inputs in the service layer with explicit limits
   (max lengths, max item counts).
4. **Routes & UI** — build pages using [ui-patterns.md](ui-patterns.md). Data access via
   remote functions (`query()`/`form()` in `src/lib/remote/`). Add nav links in the
   relevant layout (member / band / staff).
5. ~~**Seed data**~~ — **do this with step 2, as soon as the schema settles.** Kept numbered
   here only so the steps below keep their numbers.
6. **Tests** — write tests that describe **intended behavior**, not the current
   implementation. Service-level mocks where direct DB access isn't practical. A failing
   test that reflects unfinished business logic is acceptable.
7. **Verify** — `pnpm check` and confirm no new type errors in files you touched
   (pre-existing errors in unrelated files can be ignored).
8. **Document** — add the feature row to the feature catalog
   (`docs/reports/feature-catalog.md`); update/add help
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
  `pnpm db:reset`, then check row counts in the child tables.

## Layering rules

```
+page.svelte → src/lib/remote/*.remote.ts → src/lib/server/<domain>/ → db
```

- Components never import from `$lib/server/` directly; they call remote functions.
- Every remote function starts with a **guard** (`requireUser`, `requireStaff`,
  `requireGroupRole`, `requireFeature`, ...) and validates its input with a **Zod
  schema**. A guard in the layout is not a guard on the data — the remote function is the
  security boundary.
- A group-scoped guard takes the group as an **argument**, never from `params`. A remote
  function's `params` describe the page the client says it is on; the slug or id is a
  lookup key that the guard resolves before checking the caller's role on what it
  resolved.
- Business logic lives in services; remotes are thin (guard + validate + orchestrate).
- Services throw typed domain errors; remotes map them via `mapDomainError()`
  (`src/lib/server/errors.ts`).
- Prefer DTO-shaped return values over passing raw rows to the UI; never return
  string-indexed grab-bag objects from services.
- Side effects (emails, notifications, cascades) go through the event bus
  (`src/lib/server/event-bus/`) and must be idempotent.

## Where a file goes

Layering says which _tier_ a file belongs to. This says which _folder_.

### Components

**Route-local by default.** A component used by one page lives next to that page's
`+page.svelte` — `src/routes/staff/events/CreateEventModal.svelte`, not a lib folder. Move it
into `src/lib/components/` only when a second route actually imports it. Fifty-odd components
live this way and it is the SvelteKit convention, not a shortcut.

For everything that is genuinely shared, `src/lib/components/` has exactly four kinds of
folder:

| Folder      | What belongs there                                                  |
| ----------- | ------------------------------------------------------------------- |
| `ui/`       | Design-system primitives. Domain-free, prop-driven, used anywhere.  |
| `layout/`   | The app frame a `+layout.svelte` mounts around pages.               |
| `actions/`  | The `*Action.svelte` family — one flat registry of the one pattern. |
| `<domain>/` | Everything else, filed under the domain it serves.                  |

The decision, in order:

1. Does it import `$lib/remote`, `$lib/server`, or a domain type? **No → `ui/`.** This is
   enforced: `custom/no-domain-imports-in-ui` errors on a `$lib/remote` or `$lib/server`
   import under `ui/`, including a type-only one.
2. Is it the persistent frame — mounted once by a `+layout.svelte`, and aware of the current
   route, the nav tree, or the signed-in user? **→ `layout/`.** Both halves must hold.
   `ErrorToastBoundary` is mounted by every layout but is prop-driven and route-blind, so it
   stays a `ui/` primitive; `RecordNav` is page-level despite the name.
3. Is it an `*Action.svelte`? **→ `actions/`.** They span every domain but are one repeated
   pattern, and the flat list is what makes "does an action for this already exist?"
   answerable at a glance.
4. Otherwise **→ `<domain>/`**, the same domain word the service uses.

There is no `shared/`. That folder was both the design system and a second feature bucket,
which meant two plausible homes for every domain component and no rule to pick between them.
If a new component does not obviously fit one of the four, that is a signal about the
component, not a reason for a fifth folder.

### Tests

Specs are colocated with what they test and named `.spec.ts` — never `.test.ts`. The vitest
`include` globs only match `*.spec.*`, so a misnamed file does not fail, it silently never
runs.

Remote-function specs are `<module>.remote.spec.ts`, and a spec covering one slice of a large
module appends the scenario: `events.remote.validation.spec.ts`, not
`events-validation.remote.spec.ts`. The point is that every spec sorts directly beneath the
module it covers in a directory listing.

Do not merge two spec files just because they cover the same module. Sibling specs carry
different `vi.mock` preambles, and unioning those quietly guts whatever the stricter one was
testing.

#### One full suite per machine

`pnpm test:unit -- --run` takes a machine-wide lock (`scripts/lib/unit-lock.ts`) and **waits**
if another one-shot suite is already running, printing who holds it. `vite.config.ts` halves
`maxWorkers` off `availableParallelism()` for the same reason, but that is a per-process guess:
on eight cores one suite takes four workers as intended and two suites take all eight, plus a
headless-chromium pool each for the `client` and `storybook` projects.

This is the sibling of `e2e/lock.ts`, with the difference that matters: **e2e refuses a second
run, this one queues it.** e2e refuses because its runs share database state and its assertions
are load-dominated, so a queued run would still be worth nothing. Unit tests share no state —
two of them give the same answers as one, only far slower — so waiting is lossless and refusing
would turn "a colleague is testing" into a red suite.

Watch mode and CI both skip the lock: watch mode would hold it all afternoon and idles between
runs anyway, and a CI runner has the machine to itself. If a wait ever exhausts its 15 minutes
the run proceeds regardless — overlapping is slow, never wrong, so the worst case is today's
behaviour rather than a new way to fail.

## Forms: no raw elements

Every form in a route file uses the shared components from
`$lib/components/ui/Form/` — `Form`, `FormField`, `SubmitButton` — never raw `<form>`,
`<input>`, or `<select>` elements, even for small inline forms. Mutations use `form()` from
`$app/server` in a `.remote.ts` file so `<Form>` wires up validation and dirty tracking
automatically. Full patterns and component API: [ui-patterns.md](ui-patterns.md).

## Custom ESLint rules

Seven project-specific rules live in `eslint-rules/` and are registered once as the
`custom` plugin in `eslint.config.js` (note the comment there: registering the plugin in
more than one config object crashes eslint with "Cannot redefine plugin custom").

| Rule                                  | Severity / scope                                                      | What it flags → what to do instead                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom/no-db-transaction`            | **error** on `src/lib/server/**/*.ts` (excluding specs)               | Any `.transaction()` call — broken on D1. Use `db.batch([...queries])` for atomic writes.                                                                                                                                                                                                                                                                                                                                   |
| `custom/no-raw-form-elements`         | **warn** on `+page.svelte` files                                      | Raw `<form>` elements in pages. Use the `<Form>` component.                                                                                                                                                                                                                                                                                                                                                                 |
| `custom/no-utility-soup`              | **warn** on `+page.svelte` files                                      | Hand-written utility-class soup where a component or semantic utility exists: >5 classes on one element, a raw `btn`/`card`/`badge`/`alert`/`stat`/`table`, the dead `*-bordered` classes, `text-sm opacity-60` instead of `text-muted`, or an inline `style` reaching a `var(--…)`. See `template-audit.md`.                                                                                                               |
| `custom/no-duplicate-field-names`     | **error** on all `*.svelte`                                           | Two fields submitting the same `name` within one `<Form>` (statically resolvable names only) — the later value silently wins on submit. Rename one.                                                                                                                                                                                                                                                                         |
| `custom/no-concurrent-remote-queries` | **error** on all `*.svelte`                                           | Two or more remote queries fanned out at once — `Promise.all`/`allSettled`/`race`/`any` over calls imported from a `*.remote` module, in script or template. A page gets one load-bearing query: assemble them in a single remote query on the server, or move what the first paint does not need behind its own boundary to load lazily. Past kit 2.64 this shape also renders the page as `effect_update_depth_exceeded`. |
| `custom/refresh-the-composed-query`   | **error** on `src/lib/remote/**/*.remote.ts`                          | `.refresh()` on a query that is composed into another query in the same file — nothing reading the wrapper repaints from it, so a save appears to do nothing. Refresh the wrapper too, or instead if nothing reads the constituent directly any more.                                                                                                                                                                       |
| `custom/no-domain-imports-in-ui`      | **error** on `src/lib/components/ui/**` (excluding specs and stories) | A `$lib/remote` or `$lib/server` import — including a type-only one — inside the design system. The component belongs in `components/<domain>/`, or `components/layout/` if a `+layout.svelte` mounts it to frame pages. See [Where a file goes](#where-a-file-goes).                                                                                                                                                       |

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

| Script                          | What it does                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dev`                           | Vite dev server on :5173 (a worktree gets its own port — `scripts/lib/checkout-ports.ts`)      |
| `build`                         | `vite build` (output: `.svelte-kit/cloudflare/`)                                               |
| `preview`                       | Serve the production build on :4173 (a worktree gets its own port)                             |
| `prepare`                       | (auto on install) svelte-kit sync + lefthook install                                           |
| `check` / `check:watch`         | svelte-check type checking                                                                     |
| `test:unit`                     | Vitest (watch mode; `--run` for one-shot, which queues behind any other full suite)            |
| `test:components`               | One-shot client (browser) + storybook vitest projects                                          |
| `test:e2e`                      | Migrate + seed a local D1, then run Playwright `e2e/**/*.e2e.ts`                               |
| `test:e2e:prepare`              | Just the migrate + seed half (CI runs it as its own step)                                      |
| `test:e2e:run`                  | Just the Playwright half — takes its flags, e.g. `-- --workers=1`                              |
| `test`                          | Full suite: unit one-shot + e2e (what CI runs)                                                 |
| `test:report`                   | Vitest with JSON output → `test-results.json`                                                  |
| `lint`                          | prettier `--check` + eslint over everything                                                    |
| `lint:changed`                  | Lint only files changed vs `origin/main` (`scripts/lint-changed.sh`; PR CI uses this)          |
| `format`                        | prettier `--write` everything                                                                  |
| `db:generate`                   | drizzle-kit: generate a migration from schema changes, then make any table rebuild D1-safe     |
| `db:fix-migrations`             | Rewrite unsafe table rebuilds (run automatically by `db:generate`)                             |
| `db:check-migrations`           | Fail if any migration has an unsafe table rebuild (runs in CI)                                 |
| `db:migrate`                    | drizzle-kit: apply pending migrations to **remote** D1                                         |
| `db:migrate:local`              | Apply pending migrations to the local D1 (tracked; a no-op when current)                       |
| `db:seed`                       | Run `scripts/seed-dev.ts` against local D1                                                     |
| `volunteer:seed-roles`          | Seed the volunteer role catalogue (`scripts/seed-volunteer-roles.ts`)                          |
| `db:reset`                      | Wipe local D1 + migrate + seed                                                                 |
| `db:studio`                     | drizzle-kit studio GUI (**remote** D1 — needs `CLOUDFLARE_*` vars)                             |
| `ci:migrate`                    | Remote migrate, but only on `main` — prepended to `pnpm build` by the Cloudflare build command |
| `storybook` / `build-storybook` | Storybook on :6006 / static build                                                              |
| `stripe:sync-webhooks`          | Sync the Stripe webhook endpoint's event list to the code registry                             |
| `help:sync`                     | Upsert `src/content/help/**` articles into the D1 help tables                                  |
| `docs:routes`                   | Regenerate the route snapshot `docs/manual/route-inventory.json`                               |
| `docs:check`                    | Docs integrity + route-drift check (CI gate)                                                   |
| `email:push` / `email:pull`     | Sync Postmark transactional templates repo ↔ Postmark                                          |
| `email:preview`                 | Render the templates to `.email-preview/` for eyeballing                                       |
| `email:validate`                | Check template syntax and required variables                                                   |

## Docs workflow (when you change routes or help content)

Before opening a PR that adds/removes/moves a route or touches help articles:

1. Update or add the help article(s) in `src/content/help/` and the manifest in
   `docs/manual/README.md`.
2. `pnpm docs:routes` — regenerate and commit `docs/manual/route-inventory.json`.
3. `pnpm docs:check` — must pass; CI fails the PR on integrity errors.
4. New feature shipped? Add its row to the feature catalog `docs/reports/feature-catalog.md`
   (checklist phase 8)
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

### Analytics and reporting tools

Which vendor owns which question, so this is not re-litigated per feature. The governing rule
lives in `docs/specs/reporting-spec.md`: **a report belongs in the app only when it joins data no
single vendor holds.**

| Question                                                              | Where it is answered                                                                    | Notes                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Anything over our own records — members, hours, reservations, tickets | **D1, in app**                                                                          | Module-owned `*-report-service.ts` over drizzle aggregates        |
| Revenue totals, payouts, reconciliation                               | **Stripe** — dashboard reports, or the Reporting API for the same CSVs programmatically | Sigma is a paid add-on and is not warranted at this volume        |
| Email delivery, opens, clicks, bounces                                | **Postmark Stats API** — filterable by stream, tag and date                             | Not yet read by any code; `campaign` stores only `recipientCount` |
| Site traffic, referrers, Core Web Vitals                              | **Cloudflare Web Analytics** — free, cookieless, on all plans                           | Not enabled yet. Prefer it over adding PostHog, GA or Plausible   |
| Errors, traces, cron check-ins                                        | **Sentry**                                                                              | Already wired, including Cloudflare native OTLP traces and logs   |
| A one-off question nobody has asked twice                             | **`wrangler d1 export --remote`** → SQLite → DuckDB, Metabase, a spreadsheet            | Reach for this before building a page                             |

Three Cloudflare products look like they fit application reporting and do not:

- **Workers Analytics Engine** stores custom events, but retains them for 90 days and downsamples
  at volume — aggregates use `SUM(_sample_interval)`, not `COUNT()`. An annual report needs more
  than a year of history and a number a funder can rely on, so neither property is survivable.
  It remains the right tool if a concrete "how often is feature X used?" question ever arrives;
  there is deliberately no `analytics_engine_datasets` binding in `wrangler.toml` until one does.
- **The GraphQL Analytics API** reports Cloudflare product metrics, not application data. Its own
  docs warn it is not accurate enough for Cloudflare's billing.
- **Workers Logs** is developer observability with days of retention, and is already forwarded to
  Sentry via `[observability.logs]`.

Full-fat BI — Cube, Evidence, Metabase, Superset — is rejected for in-app reporting: none runs in
a Worker or reads D1, each is a second deployment to operate, and the ad-hoc case they would serve
is covered by the D1 export above.

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
