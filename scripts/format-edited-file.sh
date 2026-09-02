#!/usr/bin/env bash
# Claude Code PostToolUse hook: auto-format the single file just edited.
# Reads the hook payload as JSON on stdin and acts on .tool_input.file_path.
# Warn-only: prettier runs on the one file and never fails the tool call (exit 0).
#
# Neither svelte-check nor eslint runs here, for the same reason: both are
# whole-project tools, and this fires on EVERY edit of EVERY agent. eslint looks
# per-file but isn't — `parserOptions.projectService` builds a TypeScript program
# over the whole project on each invocation, so `eslint --fix` on one file cost
# ~10s of the ~11s this hook used to take, and a worktree per agent meant several
# of those programs alive at once on an 8-core machine. Lint findings come from
# CI's `Lint (changed)` instead; `pnpm lint` runs it locally on demand.
#
# Keep this hook cheap enough that its cost never enters the conversation: run the
# binary directly rather than through `pnpm exec`, which measured ~300ms of pure
# wrapper against prettier's own ~350ms.

PAYLOAD=$(cat)
FILE=$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // empty')

# Nothing to do if no path or the file no longer exists.
[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0

# Only handle the source types prettier is configured for here. The wider set
# (.md/.json/.css/.yml/…) is covered by lefthook's pre-commit prettier job. This
# list is the code half of scripts/lint-changed.sh's FORMATTABLE — keep them in
# step, or an extension lands in the repo that no gate is watching.
case "$FILE" in
	*.ts | *.js | *.mjs | *.cjs | *.svelte) ;;
	*) exit 0 ;;
esac

# Resolve the binary relative to this script's checkout, so a worktree uses its
# own node_modules rather than whichever one the cwd happens to point at.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PRETTIER="$ROOT/node_modules/.bin/prettier"
[ -x "$PRETTIER" ] || PRETTIER="pnpm exec prettier"

$PRETTIER --write "$FILE" 2>&1 || true

exit 0
