# CorvMC

SvelteKit 2 / Svelte 5 on Cloudflare Workers. D1 + drizzle, better-auth, Tailwind 4 + daisyUI,
Stripe, Postmark. Documentation index: `docs/README.md`.

## Read first

- `docs/development/conventions.md` — feature checklist, layering rules, custom lint rules, scripts
- `docs/development/ui-patterns.md` — **before touching any page**; shared components + composition
- `docs/architecture/overview.md` — how the system is wired

## Commands

Always through `pnpm`. A global prettier 2.8.8 shadows this project's prettier 3, so `npx prettier`
reports results that are simply wrong.

| Command                         | Gate                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `pnpm check`                    | svelte-check — the type gate                               |
| `pnpm lint:changed`             | prettier + eslint vs `origin/main` (what PR CI runs)       |
| `pnpm lint`                     | the whole tree, including markdown — run before committing |
| `pnpm test:unit -- --run`       | vitest, one shot                                           |
| `pnpm test:e2e`                 | playwright — add `--workers=1` locally                     |
| `pnpm docs:check`               | docs integrity; CI fails the PR on it                      |
| `pnpm db:generate`              | the only way to create a migration                         |
| `pnpm db:reset && pnpm db:seed` | rebuild local D1                                           |

These mirror the CI jobs in `.github/workflows/ci.yml`, so a green local gate is a green PR.

## Rules

- **Remote functions are the security boundary.** Data access is `query()`/`form()` in
  `src/lib/remote/`: guard first (`requireUser`, `requireStaff`, `requireBandMember`,
  `requireFeature`, …), Zod schema second, then orchestrate. They bypass route and layout loads and
  take their params from a client header — a guard in a layout guards nothing. Components never
  import from `$lib/server/`.
- **No `db.transaction()`** — it is broken on D1. Use `db.batch([...])`. ESLint errors on it.
- **Migrations come only from `pnpm db:generate`.** Never hand-write one; never edit one that is
  already committed.
- **Forms use `$lib/components/shared/Form/`** (`Form`, `FormField`, `SubmitButton`) — never a raw
  `<form>`, `<input>`, or `<select>`, not even inline.
- **No gradients** in any interface.
- **No co-author lines** in commit messages.

## Workflow

Anything that adds schema or spans several files follows the nine phases in
`docs/development/conventions.md#the-feature-checklist`. A small, single-file change just gets made
and gated.

The finishing steps that are easiest to skip: extend `scripts/seed-dev.ts` so the feature has
realistic local data, add its row to `docs/reports/parity-report.md`, and run
`pnpm docs:routes && pnpm docs:check` if any route moved.

**A finished PR is queued, not merged.** `gh pr merge --auto --squash`, and the session ends there.
GitHub rebases each entry onto the queue head and runs CI on that, so a branch never has to be up to
date to be queued and two sessions finishing at once no longer race for the merge. Do not run
`gh pr update-branch`, do not wait for the merge to land, and never pass `--admin` — it bypasses the
queue, which is the one way back to the race. No `--delete-branch` either: `gh` refuses it outright
while a queue is enabled, and the repo deletes merged branches on its own.

The one thing queueing does not survive is a failed check: GitHub disarms auto-merge when a required
check goes red, so a PR left queued after a flake sits open indefinitely with nothing watching it.
Re-run the job, then arm it again — the queue does not pick it back up on its own.

## Worktrees

Work usually happens in a `git worktree` under `.claude/worktrees/`. Edit paths inside the worktree
— a subagent may report paths in the main checkout. A fresh worktree has no `node_modules`, `.env`,
or `.dev.vars`; running anything from one needs setup first: `/worktree-dev`.
