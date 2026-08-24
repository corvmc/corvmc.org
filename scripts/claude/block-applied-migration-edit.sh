#!/usr/bin/env bash
# PreToolUse guard: refuse to hand-edit a migration that is already committed.
#
# `docs/development/conventions.md` states the rule ("never edit an applied
# migration"), but an instruction is a request. This makes it enforcement.
#
# "Committed to git" stands in for "applied": it needs no journal parsing, and it
# still leaves a migration you just generated — and have not committed — editable
# by regeneration. Exit 2 blocks the tool call and shows stderr to the model.
set -uo pipefail

payload=$(cat)

path=$(printf '%s' "$payload" | node -e '
	let raw = "";
	process.stdin.on("data", (c) => (raw += c));
	process.stdin.on("end", () => {
		try {
			const input = JSON.parse(raw).tool_input ?? {};
			process.stdout.write(input.file_path ?? input.path ?? "");
		} catch {
			process.stdout.write("");
		}
	});
' 2>/dev/null)

[ -n "$path" ] || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
rel=${path#"$repo_root"/}

case "$rel" in
migrations/*) ;;
*) exit 0 ;;
esac

# Untracked means freshly generated and not yet committed — editing is fine.
git -C "$repo_root" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1 || exit 0

cat >&2 <<MSG
Blocked: $rel is a committed migration.

Migrations are append-only once committed — editing one desynchronizes every
database that already ran it.

  - Schema change?          edit the drizzle schema, then \`pnpm db:generate\`
  - Unsafe table rebuild?   \`pnpm db:fix-migrations\`
  - Genuinely dropping a table with FK children? add the marker comment to a NEW
                            migration: -- d1-safe-rebuild: intentional drop \`table\`

See docs/development/conventions.md#table-rebuilds-on-d1
MSG
exit 2
