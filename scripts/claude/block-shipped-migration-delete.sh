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
#
# `git update-index --force-remove` drops the index entry with no `rm` in the command
# at all. Only its removing flags count as one: `--assume-unchanged` and the rest of
# update-index touch no content, and treating those as a delete would be a new false
# positive on a command that removes nothing.
rm_segments=$(printf '%s' "$command" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g; s/|/\n/g' |
	grep -E '(^|[[:space:]])((git[[:space:]]+)?rm([[:space:]]|$)|git[[:space:]]+update-index[[:space:]].*--(force-)?remove([[:space:]]|$))')

[ -n "$rm_segments" ] || exit 0

# Pull every `migrations/<dir>[/<file>]` those segments name, however they are quoted.
# `*` and `?` are part of a name here so a glob is captured rather than truncated at
# the metacharacter — `migrations/2026*` read as the directory `migrations/2026`, which
# main does not have, and the command was allowed through.
paths=$(printf '%s\n' "$rm_segments" |
	grep -oE '(^|[^A-Za-z0-9_/.*?-])migrations/[A-Za-z0-9_.*?-]+(/[A-Za-z0-9_.*?-]+)?' |
	sed 's#.*\(migrations/\)#\1#' | sort -u)

# `snapshot.json` is the one file inside a shipped folder that is safe to remove:
# `scripts/db/prune-snapshots.mjs` keeps only the newest and deletes the rest on every
# `pnpm db:generate`, and merging main into a branch that owns migrations resolves its
# snapshot conflict the same way. No database has applied it. Everything else the
# command names — the folder itself, or its `migration.sql` — still counts.
dirs=$(printf '%s\n' "$paths" | grep -v '/snapshot\.json$' |
	sed 's#^\(migrations/[A-Za-z0-9_.*?-]*\)/.*#\1#' | sort -u)

# A glob names no directory that can be looked up, so resolve it against the ones
# origin/main has — `rm -rf migrations/*` destroys all of them. Expanding rather than
# refusing outright is what keeps `migrations/<draft-prefix>*` permitted: it expands to
# nothing main knows, exactly as spelling the draft out does.
shipped_tree=""
expanded=""
for dir in $dirs; do
	case "$dir" in
	*[*?]*)
		[ -n "$shipped_tree" ] ||
			shipped_tree=$(git -C "$repo_root" ls-tree --name-only origin/main migrations/ 2>/dev/null)
		for entry in $shipped_tree; do
			# An unquoted pattern is the point: this is glob matching, not equality.
			# shellcheck disable=SC2254
			case "$entry" in
			$dir) expanded="$expanded$entry
" ;;
			esac
		done
		;;
	*) expanded="$expanded$dir
" ;;
	esac
done
dirs=$expanded

# A remove aimed at the directory itself — `rm -rf migrations/` — names no child and
# would otherwise slip past. It takes every shipped migration with it, so treat the
# whole tree as the target. A command that named only snapshots is not that case.
if [ -z "$paths" ] &&
	printf '%s\n' "$rm_segments" | grep -qE '(^|[^A-Za-z0-9_/.-])migrations/?([[:space:]]|$)'; then
	dirs=$(git -C "$repo_root" ls-tree --name-only origin/main migrations/ 2>/dev/null)
fi

[ -n "$dirs" ] || exit 0

shipped=""
for dir in $dirs; do
	# A directory `origin/main` knows has shipped. `git cat-file -e` is the cheapest
	# existence check that does not need the ref checked out.
	# Unresolvable `origin/main` fails open: a clone that never fetched it gets no
	# guard rather than a blanket refusal of every delete.
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
