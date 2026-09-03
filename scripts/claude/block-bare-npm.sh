#!/usr/bin/env bash
# PreToolUse guard: this repo is pnpm-only.
#
# A global prettier 2.8.8 sits ahead of the project's prettier 3 on PATH, so
# `npx prettier` reports formatting results that are simply wrong — and an `npm
# install` writes a package-lock.json that nothing here consumes.
#
# The two traps this used to carry inline — "pnpm" ends in "npm", and a heredoc
# body is documentation rather than an invocation — belong to every guard that
# scans a command, so they moved to `lib/command-segments.mjs`, which prints one
# executable segment per line. Matching the start of a segment is what keeps
# both of them handled.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
offender=$(node "$here/lib/command-segments.mjs" 2>/dev/null |
	grep -oE '^(npm|npx)([[:space:]]|$)' | head -1 | tr -d '[:space:]')

[ -n "$offender" ] || exit 0

cat >&2 <<MSG
Blocked: this repo is pnpm-only, and \`$offender\` is not.

A global prettier 2.8.8 shadows the project's prettier 3, so running the
project's tooling through npx reports results that do not match what CI checks.

  npm run <script>  ->  pnpm <script>
  npm install       ->  pnpm install
  npx <bin>         ->  pnpm exec <bin>

Script reference: docs/development/conventions.md#pnpm-script-reference
MSG
exit 2
