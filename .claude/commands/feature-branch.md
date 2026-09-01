# feature-branch

Start, refresh, or land a long-lived feature branch — the thing that replaced feature flags for
work that spans several PRs.

The sequences below are short. Their value is being run **in order**: fetch before merging,
`drizzle-kit check` before deciding anything about migrations, `db:reset` in every worktree, never
stash, never rebase, never force-push. Getting one of those wrong is how a branch takes a sibling
session's work with it.

$ARGUMENTS

Read the mode from the arguments: `start <slug>`, `refresh`, or `land`. With no arguments, say
which modes exist and stop.

## start &lt;slug&gt;

```bash
git fetch origin main
git switch -c feature/<slug> origin/main
git push -u origin feature/<slug>
```

Then set up a worktree for it — `.claude/skills/worktree-dev/SKILL.md` is the procedure; do not
re-derive it here.

Enable rerere once per clone if it is not already on. A feature branch merges `origin/main`
repeatedly and hits the same conflicts each time; this replays the resolutions:

```bash
git config rerere.enabled true
```

Then say plainly which phases will land on `main` directly and which need the branch:

- **Staff-only surfaces go straight to `main`.** A half-built admin page is a normal intermediate
  state — the staff panel was never gated.
- **Schema and refactors go straight to `main`** when they are safe standing alone.
- **The branch is for member-facing and public surfaces**, which reach `main` only once the
  capability behind them works.

If everything in the spec is one of the first two, do not open a branch at all.

## refresh

Run in the worktree that owns the branch, with **no dev server, preview, or e2e run live** —
workerd holds real locks on the local D1 files.

```bash
git status --porcelain    # must be empty. Commit; never stash — the stash is
                          # shared with every other worktree in this repo.
git fetch origin main
git merge origin/main     # a real merge commit. Never rebase: other worktrees hold
                          # this branch and open phase PRs would redisplay every
                          # merged phase as new commits.
```

Resolve conflicts, minding the four that recur:

| File                                                             | How to resolve                                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/d1-table-order.mjs`                                     | **Position is semantic** — a table must follow everything it references. Taking both sides yields a file that lints clean and breaks the seed at runtime. Re-derive placement from the foreign-key graph. |
| `scripts/seed-dev.ts`                                            | Take both. Each feature owns one `seedX()` appended at the end plus one line in `main()`.                                                                                                                 |
| `src/lib/server/db/schema/index.ts`, `src/routes/*/nav-items.ts` | Append-only lists; take both sides, then run the adjacent `nav-items.spec.ts`.                                                                                                                            |
| `pnpm-lock.yaml`                                                 | Never hand-resolve: `git checkout --theirs pnpm-lock.yaml && pnpm install`.                                                                                                                               |

Then, **only if this branch owns migrations**:

```bash
pnpm install --frozen-lockfile
pnpm exec drizzle-kit check
```

- **Exit 0** — the fork is commutative. **Change nothing under `migrations/`.** Snapshots carry
  `prevIds` (plural), so the next real `pnpm db:generate` lists both heads and closes the fork on
  its own. Leaving it open is CI-green.
- **Non-zero** — the two chains touch the same entity. Collapse this branch's own migrations into
  one. Also collapse, whatever `check` says, if this branch owns a `d1-safe-rebuild` migration
  whose detach set includes a table `main` has since altered. The procedure is
  [in the conventions](../../docs/development/conventions.md#long-lived-feature-branches); it
  deletes only the directories `origin/main` does not have, and
  `scripts/claude/block-shipped-migration-delete.sh` refuses the rest.

Finish:

```bash
pnpm db:reset            # not db:migrate:local — migrations are selected by name, with no
                         # timestamp watermark, so an incremental run would apply main's
                         # older migrations after yours and build an order nothing else has.
pnpm check && pnpm lint:changed && pnpm test:unit -- --run
git push origin HEAD     # fast-forward. No force, ever.
```

Tell every other worktree on this branch to run
`git pull --ff-only && pnpm install --frozen-lockfile && pnpm db:reset`. The `--ff-only` is
load-bearing: it succeeds after a merge and fails after a rebase, which is how a stray rebase gets
caught.

## Phase PRs (any time)

A phase targets the feature branch, not `main`:

```bash
gh pr create --base feature/<slug> --title "<spec> phase N: <what it does>"
```

CI runs every check on a non-`main` base — `.github/workflows/ci.yml` has no `branches:` filter on
`pull_request`. Merge with `gh pr merge --squash` (squash is the only method the repo allows). The
merge queue guards `main` only, so a phase PR merges directly — **read the checks yourself before
merging**, because no branch protection is stopping you.

Run `pnpm lint:changed` locally against the right base:

```bash
BASE_REF=origin/feature/<slug> pnpm lint:changed
```

## land

Only when the feature is complete and its member-facing surfaces work.

Work the nine-phase checklist's finishing steps first — seed data, the feature catalog row,
`pnpm docs:routes && pnpm docs:check` if a route moved, and retire the spec into
`docs/specs/shipped/`. Then:

```bash
gh pr create --base main --title "<spec>: <the feature>"
gh pr merge --auto
```

No merge method flag, no `--admin`, no `gh pr update-branch`, no `--delete-branch` — the standing
rules in `CLAUDE.md` apply unchanged. The session ends there.

The queue squashes, so `main` gets one commit for the whole feature. The phase commits stay
fetchable afterwards even though the branch is deleted, because GitHub keeps the PR refs:

```bash
git fetch origin refs/pull/<phase-pr-number>/head
```
