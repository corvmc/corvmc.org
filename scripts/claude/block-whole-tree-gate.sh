#!/usr/bin/env bash
# PreToolUse guard: CI is the gate, not this machine.
#
# Every gate in this repo has a job in `.github/workflows/ci.yml` that runs it on
# the PR and again on the merge-queue ref. Running the whole tree locally cannot
# change an outcome — it only delays the push, on a machine several worktree
# sessions are already sharing. `lefthook.yml` makes the same argument for git
# hooks; this makes it for agent sessions, which is where the hour actually goes.
#
# Scoped runs are the point and stay allowed: a blast-radius spec directory,
# `pnpm lint:changed`, `pnpm check`, `pnpm test:changed`. The matcher and its
# reasoning live in `lib/whole-tree-gate.mjs`.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
hit=$(node "$here/lib/whole-tree-gate.mjs" 2>/dev/null)

[ -n "$hit" ] || exit 0

job=${hit%%$'\t'*}
segment=${hit#*$'\t'}

cat >&2 <<MSG
Blocked: \`$segment\` is the "$job" CI job, run here.

That job runs on this PR and again on the merge-queue ref, so a local pass adds
no information and a local failure under load is not evidence of one — a starved
ESLint reads as a violation, and an OOM-killed vitest prints \`[killed]\` with no
summary at all.

Verify the blast radius of what you changed, then push:

  pnpm vitest --run --project=server src/lib/server/<domain>   # the directory, not the file
  pnpm lint:changed
  git push && gh pr merge --auto

Then read the run. If the user asked for this full run in this turn, prefix it:
\`CMC_FULL_GATE=1 $segment\`.
MSG
exit 2
