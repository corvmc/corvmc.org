#!/usr/bin/env bash
# PreToolUse guard: refuse to delete a migration that already exists on `origin/main`.
#
# The integration-branch workflow adds one legitimate reason to delete a migration:
# collapsing a branch's own not-yet-shipped migrations into a single one after
# merging `main` (docs/development/conventions.md#long-lived-integration-branches).
# That is safe precisely because those migrations have never been applied anywhere
# but a local D1 — `scripts/ci-migrate.mjs` migrates only for `main` and
# `gh-readonly-queue/main/*`.
#
# The same command aimed one directory over deletes history. Presence on
# `origin/main` is the line: a migration `main` has has run in production; one only
# your branch has is a draft. `block-applied-migration-edit.sh` covers Edit/Write —
# it cannot see a shell `rm`, which is what this covers. Exit 2 blocks the call.
set -uo pipefail

payload=$(cat)

command=$(printf '%s' "$payload" | node -e '
	let raw = "";
	process.stdin.on("data", (c) => (raw += c));
	process.stdin.on("end", () => {
		try {
			process.stdout.write(JSON.parse(raw).tool_input?.command ?? "");
		} catch {
			process.stdout.write("");
		}
	});
' 2>/dev/null)

[ -n "$command" ] || exit 0

case "$command" in
*migrations*) ;;
*) exit 0 ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Only the arguments of an actual `rm` count. Scanning the whole command string
# instead matched any command that mentioned both `rm` and `migrations/` somewhere —
# writing a *document* about collapsing migrations tripped it. Split on the shell's
# separators and keep the segments that are themselves a remove.
rm_segments=$(printf '%s' "$command" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g; s/|/\n/g' |
	grep -E '(^|[[:space:]])(git[[:space:]]+)?rm([[:space:]]|$)')

[ -n "$rm_segments" ] || exit 0

# Pull every `migrations/<dir>` those segments name, however they are quoted.
dirs=$(printf '%s\n' "$rm_segments" |
	grep -oE '(^|[^A-Za-z0-9_/.-])migrations/[A-Za-z0-9_.-]+' |
	sed 's#.*\(migrations/\)#\1#' | sort -u)

# A remove aimed at the directory itself — `rm -rf migrations/` — names no child and
# would otherwise slip past. It takes every shipped migration with it, so treat the
# whole tree as the target.
if [ -z "$dirs" ] &&
	printf '%s\n' "$rm_segments" | grep -qE '(^|[^A-Za-z0-9_/.-])migrations/?([[:space:]]|$)'; then
	dirs=$(git -C "$repo_root" ls-tree --name-only origin/main migrations/ 2>/dev/null)
fi

[ -n "$dirs" ] || exit 0

shipped=""
for dir in $dirs; do
	# A directory `origin/main` knows has shipped. `git cat-file -e` is the cheapest
	# existence check that does not need the ref checked out.
	if git -C "$repo_root" cat-file -e "origin/main:$dir/migration.sql" 2>/dev/null; then
		shipped="$shipped  $dir
"
	fi
done

[ -n "$shipped" ] || exit 0

# `rm -rf migrations/` matches all 62. Naming a handful makes the point; the count
# carries the rest.
count=$(printf '%s' "$shipped" | grep -c .)
listed=$(printf '%s' "$shipped" | head -5)
if [ "$count" -gt 5 ]; then
	listed="$listed
  ... and $((count - 5)) more"
fi

cat >&2 <<MSG
Blocked: this would delete $count migration(s) that exist on origin/main.

$listed

Those have run in production. Deleting one desynchronizes every database that
already applied it, and no later migration can put it back.

Collapsing a branch's own migrations after merging main is the legitimate case,
and it covers only directories main does not have:

  git log --oneline --diff-filter=A --name-only origin/main..HEAD -- migrations/

Delete just those, then \`pnpm db:generate\`.

See docs/development/conventions.md#long-lived-integration-branches
MSG
exit 2
