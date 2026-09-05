# CorvMC

SvelteKit 2 / Svelte 5 on Cloudflare Workers. D1 + drizzle, better-auth, Tailwind 4 + daisyUI,
Stripe, Postmark. Documentation index: `docs/README.md`.

## Read first

- `docs/development/conventions.md` — feature checklist, layering rules, custom lint rules, scripts
- `docs/development/ui-patterns.md` — **before touching any page**; shared components + composition
- `docs/architecture/overview.md` — how the system is wired
- `docs/architecture/domain-model.md` — what the tables mean: three verticals, two horizontals,
  and the shapes that recur

## Commands

Always through `pnpm`. A global prettier 2.8.8 shadows this project's prettier 3, so `npx prettier`
reports results that are simply wrong.

| Command                   | What it does                                            | CI job that already runs it |
| ------------------------- | ------------------------------------------------------- | --------------------------- |
| `pnpm check`              | svelte-check over `src`, then over everything else      | Svelte Check                |
| `pnpm lint:changed`       | prettier + eslint vs `BASE_REF` (default `origin/main`) | Lint (changed)              |
| `pnpm lint`               | the whole tree, including markdown                      | Lint (full)                 |
| `pnpm test:unit -- --run` | vitest, one shot                                        | Unit tests                  |
| `pnpm test:e2e`           | playwright — add `--workers=1` locally                  | E2E                         |
| `pnpm docs:check`         | docs integrity + route drift                            | Docs integrity              |
| `pnpm db:generate`        | the only way to create a migration                      | Schema drift                |
| `pnpm db:reset`           | rebuild local D1 (wipe + migrate + seed)                | —                           |

**Read the third column before running anything in the first.** Every one of those jobs runs on
your PR and again on the merge-queue ref, so a whole-tree run here proves nothing new — and a
whole-tree _failure_ here is not evidence of one, because a worktree per agent means several of
these fire at once on one machine, where a starved ESLint is indistinguishable from a violation
and an OOM-killed vitest prints `[killed]` and no summary at all. CI answers in one pass what local
contention cannot answer in several.

`scripts/claude/block-whole-tree-gate.sh` enforces this. Scoped runs stay open, and are the point.

### Before you push

1. **The blast radius of what you changed, not the files you edited.** For anything under
   `src/lib/server/<domain>/`, that is the whole directory —
   `pnpm vitest --run --project=server src/lib/server/<domain>` — because specs mock `drizzle-orm`
   export by export, so one new operator breaks a _sibling_ spec. ~10 files, under 3 seconds.
2. **`pnpm lint:changed`** if more than a couple of files moved.

Then commit, push, open the PR, and **arm `gh pr merge --auto` in the same turn** — opening the PR
is not the finish line. Say in the PR that the full suite was deferred to CI; never imply a green
local run you did not do. Triage of a red or rejected run is the `qc` role's job
(`.claude/agents/`, `/queue-triage`).

## Rules

- **Remote functions are the security boundary.** Data access is `query()`/`form()` in
  `src/lib/remote/`: guard first (`requireUser`, `requireStaff`, `requireBandMember`,
  `requireFeature`, …), Zod schema second, then orchestrate. They bypass route and layout loads and
  take their params from a client header — a guard in a layout guards nothing. Components never
  import from `$lib/server/`.
- **No `db.transaction()`** — it is broken on D1. Use `db.batch([...])`. ESLint errors on it.
- **Migrations come only from `pnpm db:generate`.** Never hand-write one; never edit one that is
  already committed.
- **Components go in one of four folders.** `ui/` (domain-free primitives — a lint rule errors
  on any `$lib/remote` or `$lib/server` import there), `layout/` (the frame a `+layout.svelte`
  mounts), `actions/` (the `*Action.svelte` registry), or `<domain>/`. A component used by one
  page stays next to that page instead. There is no `shared/`. See
  `docs/development/conventions.md#where-a-file-goes`.
- **Tests are `.spec.ts`**, colocated, never `.test.ts` — the vitest globs only match `.spec`,
  so a misnamed file silently never runs. `scripts/coverage.spec.ts` fails on a `.test.ts`, and on
  any source file that no tsconfig project compiles: `src` is the generated config's, everything
  else — `scripts/`, `e2e/`, `eslint-rules/`, `.storybook/`, the root configs — is
  `tsconfig.tooling.json`. A new top-level directory has to be added to one of them.
- **Forms use `$lib/components/ui/Form/`** (`Form`, `FormField`, `SubmitButton`) — never a raw
  `<form>`, `<input>`, or `<select>`, not even inline.
- **No gradients** in any interface.
- **No co-author lines** in commit messages.

## Workflow

Anything that adds schema or spans several files follows the nine phases in
`docs/development/conventions.md#the-feature-checklist`. A small, single-file change just gets made
and gated.

**Where the work lands is the first decision, not the last.** A member-facing or public feature that
needs more than one PR to become usable goes on a long-lived `feature/<slug>` branch: phases are PRs
into that branch, squash-merged as they pass, and `main` sees the feature once, working.
`/feature-branch` carries the sequences and
`docs/development/conventions.md#long-lived-feature-branches` the reasoning — in particular what to
do about migrations after merging `main`, which is not what you would guess. Staff-only surfaces,
schema and refactors still go straight to `main`; a half-built admin page is a normal intermediate
state. This replaced feature flags, which existed only to let half-built work sit on `main`.

The finishing steps that are easiest to skip: extend `scripts/seed-dev.ts` so the feature has
realistic local data, add its row to the feature catalog (`docs/reports/feature-catalog.md`), and run
`pnpm docs:routes && pnpm docs:check` if any route moved.

**A finished PR is queued, not merged.** `gh pr merge --auto`, and the session ends there. No merge
method: a queue rejects one outright ("merge method is not valid for merge queue"), and the queue's
own configuration squashes anyway.

**Arming it is yours to do, in the same turn you open the PR.** It is not gated on the user reading
the PR first, and there is no class of change — not tooling, not one that alters how sessions
themselves behave — that earns an exception. Stopping at the PR URL to let a human look leaves the
branch outside the queue with nothing watching it, and it is the more tempting mistake precisely
when the change feels consequential. If a PR genuinely should not merge without a human, say so and
open it as a draft; do not open a ready PR and quietly decline to queue it.
GitHub rebases each entry onto the queue head and runs CI on that, so a branch never has to be up to
date to be queued and two sessions finishing at once no longer race for the merge. Do not run
`gh pr update-branch`, do not wait for the merge to land, and never pass `--admin` — it bypasses the
queue, which is the one way back to the race. No `--delete-branch` either: `gh` refuses it outright
while a queue is enabled, and the repo deletes merged branches on its own.

The one thing queueing does not survive is a rejection: GitHub disarms auto-merge when the queue
run goes red, and the queue does not pick the PR back up on its own. The failed run cannot be
re-run either — the `gh-readonly-queue/main/pr-<n>-<sha>` ref is deleted on dequeue, so re-arming
auto-merge is the only way back in. `.github/workflows/merge-queue-guard.yml` catches the rejection
and leaves a `queue-rejected` label plus a comment naming the failing job; nothing re-arms
automatically. `/queue-triage` is how a session picks those up and decides.

## Worktrees

Work usually happens in a `git worktree` under `.claude/worktrees/`. Edit paths inside the worktree
— a subagent may report paths in the main checkout. A fresh worktree has no `node_modules`, `.env`,
or `.dev.vars`; running anything from one needs setup first: `/worktree-dev`.
