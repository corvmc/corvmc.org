# Codebase Conventions

The rules this codebase follows — some enforced by tooling, some by discipline. This is the
human-maintained companion to [ui-patterns.md](ui-patterns.md) (read that before touching
any page) and the [architecture overview](../architecture/overview.md).

## The feature checklist

When building a new feature, work through these phases in order:

0. **Branch** — decide where the work lands before writing any of it. Anything member-facing or
   public that takes more than one PR to become usable goes on a long-lived
   [feature branch](#long-lived-feature-branches); phases are PRs into that branch and `main` sees
   the feature once, working. Staff-only surfaces, schema, and refactors still go straight to
   `main` — a half-built admin page is a normal intermediate state. `/feature-branch start <slug>`
   sets one up.
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

   **Extend the seed in the same change.** A feature owns one file in `scripts/seed/`,
   one call in `main()` (`scripts/seed-dev.ts`) placed where its inputs already exist, and
   one line in the summary block. Every surface built between the
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
7. **Verify** — the **blast radius** of what you changed, not the files you edited: for anything
   under `src/lib/server/<domain>/`, run the whole directory
   (`pnpm vitest --run --project=server src/lib/server/<domain>`), plus `pnpm lint:changed`. That
   is the floor and the ceiling — the whole-tree gates are CI jobs that run on the PR and again on
   the queue ref, and `scripts/claude/block-whole-tree-gate.sh` blocks them here. `pnpm check` is
   still worth running when you have a specific type question; it is a required CI check either
   way, so it is not a step to perform out of habit.
8. **Document** — add the feature row to the feature catalog
   (`docs/reports/feature-catalog.md`) — one row per feature, written in the final phase, because
   that table is a recurring merge conflict when every phase edits it; update/add help
   articles and run the docs checks (see
   [Docs workflow](#docs-workflow-when-you-change-routes-or-help-content) below). If the
   feature had a spec, **retire it now** — see below.
9. **Land** — descriptive message summarizing what the feature adds. **No co-author lines.**
   A phase PR targets its feature branch and merges with `gh pr merge --squash`; the finished
   feature targets `main` and is queued with `gh pr merge --auto`. See
   [Long-lived feature branches](#long-lived-feature-branches).

### Retiring a spec

A spec describes what you intend to build. The moment it is built, it describes live
behavior instead — and a document that describes live behavior with a spec's authority is
how a doc folder starts lying, because nothing makes anyone update it. `docs/specs/` once held
23 such files, three of which asserted a feature was unbuilt that had shipped months earlier,
before an audit sorted them into `docs/specs/shipped/` and this rule got written down.

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

## Long-lived feature branches

Feature flags used to be how a half-built feature reached `main` without members seeing it. They
were not a kill switch and not a rollout tool — the staff panel ignored them deliberately — so a
branch does the same job without the registration, the toggle, the guard at every call site, and the
404 that hides a bug as effectively as it hides a feature.

The shape: `feature/<slug>` cut from `main`, phases are PRs **into** that branch squash-merged as
they pass, and one PR merges the finished feature into `main` through the queue. `/feature-branch`
carries the sequences; what follows is why they are what they are.

**Not everything needs a branch.** Instructors shipped six phases straight to `main` with no flag
and no branch, ordering the work so nothing advertised a capability that did not exist yet
(`docs/specs/instructors-spec.md`). That is the better default when it is available:

- Staff-only surfaces land on `main` directly.
- Schema and refactors land on `main` when they are safe standing alone.
- The branch is for member-facing and public surfaces that need more than one PR to work.

### What the branch costs

The queue squashes, so `main` gets **one commit per feature** rather than one per phase. `git
bisect` resolves to the whole feature and a revert is all-or-nothing — which is the point, since a
half-shipped feature is the thing being eliminated. The phase commits stay reachable after the
branch is deleted, because GitHub keeps `refs/pull/<n>/head` indefinitely:
`git fetch origin refs/pull/353/head`.

Nothing enforces the branch, and **nothing protects it**: branch protection covers `main` only, so
a phase PR can be merged with CI red. Read the checks before merging one.

### Migrations on a branch that outlives a merge from `main`

Git never conflicts under `migrations/` — each migration is its own directory, so both sides simply
coexist. That is exactly why this is worth writing down.

Snapshots carry **`prevIds`** — plural. The chain is a DAG, and `drizzle-kit generate` merges forks
by itself: `20260831171927_lame_hydra` lists both #341's and #342's snapshots as parents, and
nobody hand-edited anything. `drizzle-kit check` fails only when the two branches' statement
footprints **overlap**; disjoint schema changes are commutative and legal.

So after `git merge origin/main` on a branch that owns migrations, run `pnpm exec drizzle-kit check`
and believe it:

- **Exit 0** — change nothing. The next real `pnpm db:generate` closes the fork. `main` itself
  shipped with an open fork between #342 and #353.
- **Non-zero** — collapse this branch's own migrations into one:

  ```bash
  git log --oneline --diff-filter=A --name-only origin/main..HEAD -- migrations/
  git rm -r <only the directories that listing names>
  pnpm db:generate && pnpm db:check-migrations
  ```

  Collapse regardless of what `check` says if the branch owns a `d1-safe-rebuild` migration whose
  detach set includes a table `main` has since altered: `rebuildBlock` renders each detached child
  from _that migration's own snapshot_, so it has to meet the database in the state its snapshot
  describes.

  This is safe only because a feature branch's migrations have never run anywhere but a local D1 —
  `scripts/ci-migrate.mjs` migrates for `main` and `gh-readonly-queue/main/*` only, so a branch
  build uploads a version and skips the migrate entirely.
  `scripts/claude/block-shipped-migration-delete.sh` refuses to delete anything `origin/main` has.

Either way, finish with **`pnpm db:reset`** in every worktree holding the branch, with nothing
serving. Not `db:migrate:local`: `getMigrationsToRun()` selects by migration _name_ with no
timestamp watermark, so an incremental run applies `main`'s older migrations _after_ yours and
leaves a schema no other machine will reproduce. `db:reset` replays from empty in directory order,
which is the order a fresh production uses.

CI's **Schema drift** job catches a non-commutative fork — both `check` and `generate` run the same
`checkHandler` — and correctly ignores a benign one. The feature PR's `merge_group` run is the
first place both chains coexist, so a real conflict is caught there and the queue rejects.

### Conflicts that recur

A branch that merges `origin/main` repeatedly hits the same conflicts each time. Turn on
`git config rerere.enabled true` once per clone (it is not committed, and the common `.git` shares
it across worktrees) and it replays the resolutions.

| File                                | How it conflicts, and what to do                                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/d1-table-order.mjs`        | **Position is semantic** — a table must follow everything it references. Taking both sides produces a file that lints clean and breaks the seed at runtime. Re-derive placement from the foreign-key graph. |
| `scripts/seed-dev.ts`               | The orchestrator: `main()` and nothing else. It is now the only hot spot, and a feature touches one line of it. Seeders live one-per-file in `scripts/seed/`, so two features no longer conflict at all.    |
| `src/lib/server/db/schema/index.ts` | Chronological `export *` lines. Append; never reorder. Take both sides.                                                                                                                                     |
| `src/routes/*/nav-items.ts`         | Ordered arrays where the order is cosmetic. Take both sides, then run the adjacent `nav-items.spec.ts`, which asserts the list.                                                                             |
| `docs/reports/feature-catalog.md`   | A wide table plus a `Last updated:` line every phase wants to touch. One row per feature, in the landing PR.                                                                                                |
| `pnpm-lock.yaml`                    | Never hand-resolve: `git checkout --theirs pnpm-lock.yaml && pnpm install`.                                                                                                                                 |
| `migrations/`                       | Never conflicts, which is the trap. See above.                                                                                                                                                              |

Never rebase a feature branch and never force-push one. Other worktrees hold it, open phase PRs
would redisplay every merged phase as new commits, and `allow_force_pushes=false` protects `main`
only — nothing stops the push. Commit rather than stashing, too: the stash lives in the common
`.git` and every worktree in this repo shares it.

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

### Snapshots are pruned

drizzle-kit writes a full schema snapshot into every migration directory. Ours are ~270KB each,
against a median `migration.sql` of well under a kilobyte, so `migrations/` was 12MB of which
12.38MB was snapshots — and it grew by another 270KB every time anyone touched the schema.

Almost none of that is ever read again. Checked against drizzle-kit 1.0.0-rc.3 and drizzle-orm
1.0.0-rc.3 rather than assumed:

| Command                | Snapshots it reads                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `drizzle-kit generate` | **one** — `snapshots[snapshots.length - 1]`, the newest by path. It is the diff base for the schema |
| `drizzle-kit check`    | all, to validate each one's shape and find two migrations generated from the same parent            |
| `drizzle-kit migrate`  | **none**                                                                                            |
| `d1-safe-rebuild`      | the snapshot of each migration it rewrites, for the foreign-key graph                               |

The one that surprises people is `migrate`. It selects work by directory **name** —
`getMigrationsToRun` is `localMigrations.filter((lm) => !dbNamesSet.has(lm.name))` — and the
`hash` and `created_at` columns it writes into `__drizzle_migrations` are never read back. No
snapshot is consulted, so pruning cannot change what is or isn't applied to a database.

So `pnpm db:generate` ends by running `scripts/db/prune-snapshots.mjs`, which **keeps the newest
snapshot plus any migration not yet on `origin/main`** and deletes the rest. The second half is
what keeps a PR that generates two migrations checkable: `d1-safe-rebuild` needs the older one's
snapshot, and until it merges, it is still being authored. If `origin/main` can't be resolved the
script prunes nothing — failing open costs disk, failing closed deletes something in use.

`drizzle-kit check` still catches two branches that generated from the same parent, which is the
property worth protecting: it looks at a parent only when that parent has more than one child, and
it explicitly tolerates the parent's own snapshot being absent. Both children survive a prune,
because neither is on `origin/main` while it is still in flight.

### A table can go missing from the schema and the snapshot at once

`generate` diffs the schema files against the snapshot, so when both forget a table on the same
day, they agree and there is nothing left to generate. `product_config` did exactly that: its
schema file was deleted when the product catalogue moved to KV, the snapshot stopped declaring it
between `material_spiral` and `keen_warbound`, and no migration ever emitted the `DROP`. The
table sat in production, in every local D1 and in every e2e state directory for three months, and
the Schema drift job was always going to report no drift.

`scripts/migration-replay.spec.ts` is the check that can see it: it replays every migration's SQL
statement by statement and compares the surviving tables to the newest snapshot. Statement-level
because a table rebuild drops the table it is rebuilding, which a file-wide regex misreads as a
deletion.

Fixing one takes `pnpm exec drizzle-kit generate --custom`, which prepares an empty migration
directory with a correctly-parented snapshot for hand-written SQL. That is the one supported way
to author migration SQL yourself, and it does not break the "migrations come only from
`db:generate`" rule.

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

#### Do not assert on copy

A test must not pin the wording of anything a person reads. Rewording an empty state, a toast, an
error message or a marketing paragraph is a copy edit; it should not also be a test edit, and a
suite that makes it one is a suite that discourages fixing the copy.

Assert the thing the wording stands for:

| Instead of                                             | Assert                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `getByText('Pickup scheduled')`                        | `expectSuccessToast(page)` (`e2e/toast.ts`)                               |
| `getByText('This is off the board while…')`            | `getByRole('alert')`                                                      |
| `getByPlaceholder('Search by name or email…')`         | `getByRole('combobox')` / `getByRole('searchbox')` / `input[name]`        |
| `getByText('Out for repair')`                          | `stockReasonLabels.repair_out` from `$lib/config`                         |
| `rejects.toThrow('Reservation not found')`             | `rejects.toThrow(ReservationNotFoundError)`                               |
| `expect(result.error).toContain('Minimum duration')`   | `expect(result.code).toBe('MIN_DURATION')`                                |
| `expect(subject).toBe('Reservation reminder: May 21')` | `expect(subject).toContain('May 21')` — the interpolation is the contract |

When a service throws a bare `Error` and there is no class to assert, add one: a `DomainError`
subclass needs no registration in `errors.ts`, because `mapDomainError()` already branches on the
base — and it upgrades a 500 into the status the case deserves.

Do not add a `data-testid`. There are none in this codebase, and every case above was solved with
markup that already existed.

What is **not** copy, and stays:

- **Fixture echo** — a spec passing `title: 'X'` in and asserting `X` comes back. `SEED_*`
  constants are fixture data, not copy.
- **Render gates** — `e2e/inventory.e2e.ts`'s `visit()` waits on an `h1` by name to know an awaited
  remote query has committed. That is synchronisation, not an assertion.
- **Deliberate copy tests** — `e2e/staff-events-split.e2e.ts` asserts `Posted by` is present and
  `Created by` is absent; `e2e/band-subscription.e2e.ts` asserts premium no longer advertises a
  subdomain. These exist _because_ of the wording. Say so in a comment.
- **Short field and column labels** used as keys (`Date`, `Total`, `Reason`) — they behave like an
  API, not like prose.
- **Framework crash guards** — `not.toContainText('effect_update_depth_exceeded')` and friends.

`e2e/directory-tabs.e2e.ts`, `e2e/panel-nav.e2e.ts`, `e2e/staff-nav.e2e.ts` and
`e2e/create-band-modal.e2e.ts` are the model e2e specs; `src/lib/server/errors.spec.ts` and
`src/lib/enum-labels.spec.ts` are the model unit specs.

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

| Rule                                  | Severity / scope                                                      | What it flags → what to do instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom/no-db-transaction`            | **error** on `src/lib/server/**/*.ts` (excluding specs)               | Any `.transaction()` call — broken on D1. Use `db.batch([...queries])` for atomic writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `custom/no-raw-form-elements`         | **warn** on all `+page.svelte` files                                  | Raw `<form>` elements in pages. Use the `<Form>` component.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `custom/no-utility-soup`              | **warn** on `+page.svelte`, excluding `src/routes/band-site/**`       | Hand-written utility-class soup where a component or semantic utility exists: >5 **non-layout** classes on one element (`flex`/`grid`/`gap-*` and the alignment family `items-*`/`justify-*`/`self-*`/`place-*` are not counted — they are how you put things in a row, not a component in disguise), a raw `btn`/`card`/`badge`/`alert`/`stat`/`table` where a component owns it, the dead `*-bordered` classes, `text-sm opacity-60` instead of `text-muted`, or an inline `style` reaching a `var(--…)`. A `card` that supplies its own surface (a `bg-*/N` tint or the `surface` token) is exempt — `Card`'s `tone` cannot express it. See `template-audit.md`. |
| `custom/no-duplicate-field-names`     | **error** on all `*.svelte`                                           | Two fields submitting the same `name` within one `<Form>` (statically resolvable names only) — the later value silently wins on submit. Rename one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `custom/no-concurrent-remote-queries` | **error** on all `*.svelte`                                           | Two or more remote queries fanned out at once — `Promise.all`/`allSettled`/`race`/`any` over calls imported from a `*.remote` module, in script or template. A page gets one load-bearing query: assemble them in a single remote query on the server, or move what the first paint does not need behind its own boundary to load lazily. Past kit 2.64 this shape also renders the page as `effect_update_depth_exceeded`.                                                                                                                                                                                                                                         |
| `custom/refresh-the-composed-query`   | **error** on `src/lib/remote/**/*.remote.ts`                          | `.refresh()` on a query that is composed into another query in the same file — nothing reading the wrapper repaints from it, so a save appears to do nothing. Refresh the wrapper too, or instead if nothing reads the constituent directly any more.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `custom/no-domain-imports-in-ui`      | **error** on `src/lib/components/ui/**` (excluding specs and stories) | A `$lib/remote` or `$lib/server` import — including a type-only one — inside the design system. The component belongs in `components/<domain>/`, or `components/layout/` if a `+layout.svelte` mounts it to frame pages. See [Where a file goes](#where-a-file-goes).                                                                                                                                                                                                                                                                                                                                                                                               |

Other lint posture (see `eslint.config.js`): `no-explicit-any` and
`svelte/no-navigation-without-resolve` are downgraded to warnings; unused vars error unless
prefixed with `_`.

**The tree is at zero warnings, and both lint gates enforce it.** `pnpm lint` and
`pnpm lint:changed` both run `eslint --max-warnings 0`. There is no grandfathered allowance,
because there is no backlog left to grandfather — so any warning is one the change introduced, and
`Lint (changed)` catches it on the PR rather than after the merge.

Two consequences worth knowing before you add a rule or a disable:

- **An unused `eslint-disable` is a warning, and therefore now a failure.** That is deliberate: a
  disable outlives its reason silently otherwise. Several in this repo document a genuine type-system
  limitation (see `template-audit.md`), so a dependency upgrade that fixes one turns the directive
  red — delete it and the comment together.
- **Downgrading a rule to `warn` no longer parks it.** A warning fails the same build an error does.
  If a rule cannot be satisfied, turn it off with the reason written down, or narrow it with its own
  options — do not leave it warning as a way of half-enforcing it, which is how the count reached 628.

## Git hooks

Installed by `pnpm install` (via `prepare` → `lefthook install`), defined in `lefthook.yml`:

- **pre-commit** — prettier `--write` on staged files, auto-restaged. Warn-only: it formats what
  it can and never blocks the commit. The glob mirrors `scripts/lint-changed.sh`'s formattable
  list, so `.md`, `.json`, `.css`, `.html`, `.yml` and `.yaml` are covered too — keep the two in
  step, or an unformatted file passes the hook and reddens CI.
- There is no pre-push hook.

**Local hooks format; CI gates. Nothing local starts a TypeScript program.** That second
sentence is the operative constraint, because a worktree per agent means eight hooks can fire
at once on one 8-core machine. ESLint looks per-file but isn't: `parserOptions.projectService`
builds a program over the whole project on every invocation — ~10s of fixed startup whether you
lint one file or eight, which `--cache` cannot fix (see the note in `ci.yml`). `pnpm check` is
worse at ~60s. Both used to run in hooks; both are required CI checks, so the local copies were
pure duplication that a commit could not bypass anyway.

**The same argument, made to agent sessions.** Git hooks were never where the hour went — a
session choosing to run the suite before pushing was. `scripts/claude/block-whole-tree-gate.sh` is
a `PreToolUse` guard that refuses the whole-tree gates (`pnpm test:e2e`, `pnpm test`, `pnpm lint`,
`pnpm test:unit -- --run`, an unscoped `vitest`/`eslint`) and names the CI job that already covers
each one. The matcher turns on a single question — does the command name a path? — so a scoped
run, which is the only local check that finds something CI would find later, always passes:
`pnpm test:server src/lib/server/bands` runs, `pnpm test:server` does not. It shares its command
parsing with `block-bare-npm.sh` via `scripts/claude/lib/command-segments.mjs`, which is what keeps
a heredoc body or a commit message that merely _names_ a gate from tripping either guard.

`CMC_FULL_GATE=1` as a command prefix passes through. It means a human asked for that run in that
turn — deliberately not keyed to a session's role, because a role-keyed escape becomes the thing
that role types by reflex. `pnpm check`, `pnpm lint:changed`, `pnpm test:changed` and `pnpm format`
are not blocked at all; run them yourself when you want them.

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
| `lint:changed`                  | Lint only files changed vs `BASE_REF` (default `origin/main`; PR CI passes the PR's base)      |
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
dependency, note it in [`docs/reports/library-candidates.md`](../reports/library-candidates.md)
if it's broadly useful.

### Patched dependencies

`pnpm.patchedDependencies` in `package.json`, sources in `patches/`. Two of them:

- **`yargs@17.7.2`** — drops `"type": "module"` so its CJS entry resolves.
- **`svelte@5.57.0`** — a two-line fix in `Boundary#resolve`
  (`src/internal/client/dom/blocks/boundary.js`). Under `experimental.async`, a
  `<svelte:boundary>` with a `pending` snippet parks `$effect`s created while it is pending, then
  hands them back to the `Batch` that `increment_pending()` captured when the awaited work
  started. If that batch was merged into another and discarded in the meantime, the effects land
  in an unlinked batch — and `Batch#decrement` refuses to flush one, so they never run again. The
  patch transfers them to a live batch instead.

  Observed as the create-band modal dying after a client-side navigation into `/member/bands`
  during the turbulent post-login window: `bits-ui`'s `Dialog.Portal` mounts itself from a
  `$effect`, so a stranded effect means no dialog in the DOM at all, permanently — the button is
  dead for the life of the page, and a second click does nothing either. ~10% of runs, in CI and
  locally. `e2e/create-band-modal.e2e.ts` is the regression test; it went from 2/20 failures to
  40/40 clean with the patch. Nothing in page code triggers or avoids it, so the fix has to be
  here.

  A `pnpm install` after a Svelte bump will fail loudly if the patch stops applying. When it does,
  check whether upstream has fixed it before re-rolling the patch.

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
