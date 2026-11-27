# CorvMC

SvelteKit 2 / Svelte 5 on Cloudflare Workers. D1 + drizzle, better-auth, Tailwind 4 + daisyUI,
Stripe, Postmark. Documentation index: `docs/README.md`.

## Read first

- `docs/development/conventions.md` — feature checklist, layering rules, custom lint rules, scripts
- `docs/development/ui-patterns.md` — **before touching any page**; shared components + composition
- `docs/development/writing.md` — pass/fail rubric for every title, label and line of UI text
- `docs/architecture/overview.md` — how the system is wired
- `docs/architecture/domain-model.md` — what the tables mean: three verticals, three horizontals,
  and the shapes that recur

## Commands

Always through `pnpm`: a global prettier 2.8.8 shadows this project's prettier 3, so `npx prettier`
is wrong. `pnpm db:generate` is the only way to create a migration; `pnpm db:reset` rebuilds local
D1; `pnpm docs:check` checks docs integrity and route drift.

Whole-tree gates are CI jobs, and `scripts/claude/block-whole-tree-gate.sh` refuses them locally.
Before pushing, follow `.claude/agents/dev.md` ("What you owe before pushing"). Run
`pnpm lint:changed` **after** `git commit`: lefthook's prettier reflows comments and markup, and a
comment's delimiter lines count toward its 8-line cap. On a `feature/*` branch pass
`BASE_REF=origin/feature/<slug>`.

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
- **Commit messages carry no co-author lines.**

## Workflow

Anything that adds schema or spans several files follows the nine phases in
`docs/development/conventions.md#the-feature-checklist`; its easily skipped finish is seed data
(`scripts/seed-dev.ts`), the feature's file in `docs/reports/features/`, and `pnpm docs:routes && pnpm docs:check` if a
route moved.

**Proposals live on the issue, never in the repo.** Each build PR updates the living docs for the
behaviour it changes. Where it rejects a plausible alternative, the doc stating the rule gains a
"Not X, because Y (#n)" line beside it. No decision files; no files in `docs/specs/`.

**Where it lands is the first decision.** A member-facing or public feature needing more than one
PR goes on a long-lived `feature/<slug>` branch; staff-only surfaces, schema and refactors go to
`main`. `/feature-branch` and `docs/development/conventions.md#long-lived-feature-branches` cover
the sequences — phase PRs take `gh pr merge --auto --squash`, and merging `main` in is a
fast-forward push, not a PR.

**The branch is the claim.** Search for an issue first; if one covers the work, read its linked
PRs (an open one means pick something else), then open the **draft PR before writing code**,
branch named for the issue, `Fixes #<n>` in the body.

**The order of work is the [CorvMC Priorities](https://github.com/orgs/corvmc/projects/1) project**
(org project 1). Its `Rank` field is the order of work, 1 first; `Tier` groups the ranks;
`Status` runs Todo → Up next → In progress → In review → Done. To pick work unprompted, take the
lowest-ranked Up next or Todo item with no open PR. Add an issue you file with
`gh project item-add 1 --owner corvmc --url <issue-url>`, then set its `Rank` and `Tier` where
it belongs among its neighbours; re-rank existing items when what you learn changes their order.
Move an item to In progress or In review as its PR opens. `gh` needs the `project`
scope (`gh auth refresh -s project`).

**Finish in the same turn:** commit, push, open the PR, run `node scripts/claude/pre-arm-check.mjs <n>`
and follow its `Next:` line (stack, rebase, or arm; `/queue-triage` has the policy), arm `gh pr merge --auto` (no merge method,
no `--admin`, no `--delete-branch`, no `gh pr update-branch`), then start `gh queue await <n>` with
`run_in_background`. A PR that genuinely needs a human first is opened as a draft. A queue
rejection disarms the PR and labels it `queue-rejected`; `/queue-triage` and the `qc` agent own
re-arming.

## Worktrees

Work usually happens in a `git worktree` under `.claude/worktrees/`; edit paths inside it, even
when a subagent reports main-checkout paths. The `dev` agent always runs in its own worktree. A
worktree Claude Code creates gets `.env` and `.dev.vars` from `.worktreeinclude`, but no
`node_modules`; `/worktree-dev` covers that and worktrees made with plain `git worktree add`.

A **cloud session** (claude.ai/code) is a fresh, secretless clone that
`scripts/claude/cloud-session-start.sh` has already set up; mail, SMS and payments will not work.
If the GitHub proxy refuses `gh pr merge --auto`, open the PR and say so.
`docs/development/cloud-sessions.md` has the rest.
