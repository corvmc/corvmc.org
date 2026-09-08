#!/usr/bin/env bash
# SessionStart hook: make a Claude Code cloud session's fresh clone bootable.
#
# A cloud session (claude.ai/code) clones this repo onto a throwaway Ubuntu VM.
# The clone is exactly what git tracks, which is missing all three things this
# repo needs before anything runs:
#
#   - `.env` and `.dev.vars` are gitignored, and `src/lib/server/auth.ts` throws
#     without ORIGIN, so the app does not boot at all;
#   - `node_modules` is not there, and the VM's own pnpm is not the pinned one;
#   - `.wrangler/state` is not there, so there is no local D1 and no seed data.
#
# The environment's setup script (documented in
# `docs/development/cloud-sessions.md`) provisions the VM — pnpm 9.15.9, a warm
# pnpm store, Chromium — and its filesystem snapshot is reused across sessions.
# This handles the per-session half, which is per Anthropic's own split: setup
# script for the machine, SessionStart hook for the project.
#
# Two rules shape everything below.
#
#   1. **Local sessions must not notice it exists.** `CLAUDE_CODE_REMOTE` is
#      `true` only inside a cloud VM, and this exits before touching anything
#      otherwise. Without that check the first `cp` would overwrite the working
#      `.env` on somebody's laptop with a file of dummies — and that `.env`
#      carries a live Stripe key that is not recoverable from the repo.
#   2. **It never fails the session.** A hook that exits non-zero at startup
#      leaves an unusable session with nothing to fix from inside it, so every
#      step reports and continues. A missing dependency surfaces as a failing
#      command later, which is diagnosable; a session that would not start is
#      not.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

root=${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
cd "$root" || exit 0

say() { printf 'cloud-session-start: %s\n' "$1"; }

# 1. Environment. `cp -n` so a session that has already edited either file — or a
# resume, where this runs again — keeps what is there.
for target in .env .dev.vars; do
	if [ -f "$target" ]; then
		say "$target already present, leaving it alone"
	elif cp -n .env.cloud "$target" 2>/dev/null; then
		say "wrote $target from .env.cloud"
	else
		say "WARNING: could not write $target — the app will not boot without ORIGIN"
	fi
done

# 2. Dependencies. The `prepare` script ends in `lefthook install`, which can exit
# non-zero for reasons that have nothing to do with the install having worked, so
# the exit code is checked against the tree rather than trusted (the same trap
# `.claude/skills/worktree-dev/SKILL.md` documents for worktrees).
if [ -d node_modules ] && [ node_modules/.modules.yaml -nt pnpm-lock.yaml ]; then
	say 'dependencies already installed'
else
	say 'installing dependencies (pnpm install --frozen-lockfile)'
	pnpm install --frozen-lockfile || true
	[ -d node_modules/.bin ] || say 'WARNING: pnpm install did not produce node_modules/.bin'
fi

# 3. Chromium. Both browser-mode vitest projects and the whole e2e suite need it,
# and it comes from `cdn.playwright.dev`, which is NOT on the cloud default
# network allowlist — so this is also where a missing allowlist entry announces
# itself, by name, instead of surfacing later as three unrelated test failures.
if [ -d node_modules/.bin ]; then
	if pnpm exec playwright install chromium >/dev/null 2>&1; then
		say 'chromium ready'
	else
		say 'WARNING: playwright install chromium failed — add cdn.playwright.dev to the environment allowlist'
	fi
fi

# 4. Local D1. `pnpm db:reset` is the documented path to a known state: wipe,
# replay every migration, seed. Only when there is no database yet — a resumed
# session keeps whatever it has been working with.
if [ -d .wrangler/state/v3/d1 ]; then
	say 'local D1 already present'
elif [ -d node_modules/.bin ]; then
	say 'building local D1 (pnpm db:reset)'
	pnpm db:reset >/dev/null 2>&1 && say 'local D1 seeded — admin@corvallismusic.org / password' ||
		say 'WARNING: pnpm db:reset failed — run it by hand to see why'
fi

exit 0
