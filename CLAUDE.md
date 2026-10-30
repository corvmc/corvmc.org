# CorvMC

SvelteKit 2 / Svelte 5 on Cloudflare Workers. D1 + drizzle, better-auth, Tailwind 4 + daisyUI,
Stripe, Postmark. Documentation index: `docs/README.md`.

## Read first

- `docs/development/conventions.md` — feature checklist, layering rules, custom lint rules, scripts
- `docs/development/ui-patterns.md` — **before touching any page**; shared components + composition
- `docs/architecture/overview.md` — how the system is wired
- `docs/architecture/domain-model.md` — what the tables mean: three verticals, three horizontals,
  and the shapes that recur

## Commands

Always through `pnpm`: a global prettier 2.8.8 shadows this project's prettier 3, so `npx prettier`
is wrong.

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

Leave whole-tree runs to the CI job in the third column. Concurrent worktrees share this machine,
so a local whole-tree failure (a starved ESLint, an OOM-killed vitest printing `[killed]`) is not
evidence of one. `scripts/claude/block-whole-tree-gate.sh` enforces this; scoped runs stay open.

### Before you push

1. **The blast radius, not the files you edited.** Under `src/lib/server/<domain>/` that is the
   whole directory — `pnpm vitest --run --project=server src/lib/server/<domain>` — because specs
   mock `drizzle-orm` export by export, so one new operator breaks a _sibling_ spec.
2. **`pnpm lint:changed`** if more than a couple of files moved.

Say in the PR that the full suite was deferred to CI.

## Rules

- **Remote functions are the security boundary.** Data access is `query()`/`form()` in
  `src/lib/remote/`: guard first (`requireUser`, `requireCapability`, `requireBandMember`,
  `requireFeature`, …), Zod schema second, then orchestrate. They bypass route and layout loads and
  take their params from a client header — a guard in a layout guards nothing. Components never
  import from `$lib/server/`.
- **`db.batch([...])` for atomic writes** — `db.transaction()` is broken on D1 and ESLint errors
  on it.
- **Migrations come only from `pnpm db:generate`.** Committed migrations are immutable.
- **Components go in one of four folders:** `ui/` (domain-free; lint errors on `$lib/remote` or
  `$lib/server` imports), `layout/`, `actions/` (the `*Action.svelte` registry), or `<domain>/`. A
  component used by one page sits next to that page. See
  `docs/development/conventions.md#where-a-file-goes`.
- **Tests are colocated `.spec.ts`** — the vitest globs match only `.spec`. Every source file must
  be compiled by a tsconfig: `src` by the generated one, everything else by `tsconfig.tooling.json`,
  so a new top-level directory goes there. `scripts/coverage.spec.ts` enforces both.
- **Tests catch classes.** A bug fix names its class and adds the cheapest guard for all of it,
  from the ladder in `docs/development/conventions.md#tests-catch-classes`.
- **Forms use `$lib/components/ui/Form/`** (`Form`, `FormField`, `SubmitButton`) for every form,
  input and select, inline ones included.
- **Flat colour only** — no gradients in any interface.
- **Workflow gates warn, record and allow.** Only permission, integrity, money already moved and
  terminal states refuse. See `docs/development/conventions.md#workflow-gates`.
- **Comments: at most eight lines, stating a constraint** rather than a decision's history.
  `scripts/comment-budget.spec.ts` enforces the cap; `docs/development/conventions.md#comments`
  has the rest. Write to the rule, not to the surrounding density.
- **A problem you find but did not cause is filed.** Search
  (`gh issue list --state open --search '<terms>'`), then
  `gh issue create --template finding.md --type Bug`, labelled `agent-filed` (`--template` drops
  the file's `type:`).
- **A review with several findings is a parent issue plus one `finding.md` sub-issue each**, even
  when the ask was for "an issue". The parent holds only scope, method, and an explicit "not in
  this issue". Attach with
  `gh api --method POST repos/corvmc/corvmc.org/issues/<parent>/sub_issues -F sub_issue_id=<id>`,
  where `<id>` is the child's **database id** (`gh api repos/corvmc/corvmc.org/issues/<n> --jq .id`).
- **Commit messages carry no co-author lines.**

## Workflow

Anything that adds schema or spans several files follows the nine phases in
`docs/development/conventions.md#the-feature-checklist`; its easily skipped finish is seed data
(`scripts/seed-dev.ts`), the feature catalog row, and `pnpm docs:routes && pnpm docs:check` if a
route moved.

**Where it lands is the first decision.** A member-facing or public feature needing more than one
PR goes on a long-lived `feature/<slug>` branch; staff-only surfaces, schema and refactors go to
`main`. `/feature-branch` and `docs/development/conventions.md#long-lived-feature-branches` cover
the sequences — phase PRs take `gh pr merge --auto --squash`, and merging `main` in is a
fast-forward push, not a PR.

**The branch is the claim.** Search for an issue first; if one covers the work, read its linked
PRs (an open one means pick something else), then open the **draft PR before writing code**,
branch named for the issue, `Fixes #<n>` in the body.

**The order of work is the [CorvMC Priorities](https://github.com/orgs/corvmc/projects/1) project**
(org project 1). Its `Rank` field is the owner's order, 1 first; `Tier` groups the ranks;
`Status` runs Todo → Up next → In progress → In review → Done. To pick work unprompted, take the
lowest-ranked Up next or Todo item with no open PR. Add an issue you file with
`gh project item-add 1 --owner corvmc --url <issue-url>` and leave its `Rank` empty for the owner
to place; move an item to In progress or In review as its PR opens. `gh` needs the `project`
scope (`gh auth refresh -s project`).

**Finish in the same turn:** commit, push, open the PR, arm `gh pr merge --auto` (no merge method,
no `--admin`, no `--delete-branch`, no `gh pr update-branch`), then start `gh queue await <n>` with
`run_in_background`. A PR that genuinely needs a human first is opened as a draft. A queue
rejection disarms the PR and labels it `queue-rejected`; `/queue-triage` and the `qc` agent own
re-arming.

## Worktrees

Work usually happens in a `git worktree` under `.claude/worktrees/`; edit paths inside it, even
when a subagent reports main-checkout paths. A fresh worktree has no `node_modules`, `.env` or
`.dev.vars` — `/worktree-dev` sets it up.

A **cloud session** (claude.ai/code) is a fresh, secretless clone that
`scripts/claude/cloud-session-start.sh` has already set up; mail, SMS and payments will not work.
If the GitHub proxy refuses `gh pr merge --auto`, open the PR and say so.
`docs/development/cloud-sessions.md` has the rest.
