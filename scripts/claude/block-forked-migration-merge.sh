#!/usr/bin/env bash
# PreToolUse guard: refuse to queue a PR whose migrations fork the lineage once
# merged into `main`.
#
# `drizzle-kit` already detects this — two migrations generated from one snapshot
# is `Non-commutative migrations detected`, and `check` exits 1 on it. What it
# cannot see is the future: a branch generated while `main` was at one head can be
# perfectly clean on its own and fork the lineage the moment it lands. That is not
# hypothetical. #508 and #510 both closed the #501/#502 fork, in parallel, and both
# merged; the second re-forked `main` on exactly the failure the first had fixed,
# and blocked `pnpm db:generate` for everybody until #512.
#
# The merge queue rebases and CI does run `Schema drift` on the result, so the
# detection was there — it simply is not a required check, so the queue merged over
# a red one. That gap is a repo setting and should be closed there too. This closes
# the half a setting cannot: it fails in the session, in seconds, instead of costing
# a merge-queue slot to discover.
#
# Deliberately at `gh pr merge` and nowhere near `db:generate`. Generating a
# migration on a local branch is ordinary work and stays unguarded — a branch is
# allowed to hold an unmerged migration for as long as it likes. The question this
# asks is only ever "is it still safe to land *now*", which is the one moment the
# answer can have changed without anybody touching the branch.
#
# Fails open everywhere it cannot be sure: no `origin/main`, no `git merge-tree`, a
# conflicted merge, a `drizzle-kit` that errored for some other reason. A guard that
# blocks on its own breakage would be worse than the bug — the branch would be
# unqueueable with nothing to fix. Exit 2 blocks the call.
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

# Only an actual `gh pr merge`. Split on the shell's separators, then require the
# segment to *begin* with the command — anchored, not merely containing it. The
# sibling guard learned this the hard way: matching anywhere in the string meant
# writing a document about the workflow tripped the guard, and `echo "... gh pr
# merge --auto ..."` is one segment whose command is `echo`. A leading run of
# `VAR=value` assignments is still the same invocation.
merge_segments=$(printf '%s' "$command" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g; s/|/\n/g' |
	grep -E '^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)')

[ -n "$merge_segments" ] || exit 0

# `--disable-auto` takes a PR *out* of the queue, and `--help` asks a question. Both
# are the opposite of landing something, and blocking them would leave a branch that
# has already tripped this guard with no way to stand itself down.
merge_segments=$(printf '%s\n' "$merge_segments" | grep -vE '(^|[[:space:]])--(disable-auto|help)([[:space:]]|=|$)')

[ -n "$merge_segments" ] || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Unresolvable `origin/main` fails open, as in `block-shipped-migration-delete.sh`:
# a clone that never fetched it gets no guard rather than a blanket refusal.
git -C "$repo_root" rev-parse --verify --quiet origin/main >/dev/null 2>&1 || exit 0

# Refresh first. The whole point is that `main` may have moved since this branch
# was cut, and a stale remote-tracking ref would answer the question as it stood
# when the collision was still invisible. Bounded, and failing open on a network
# that is not there.
git -C "$repo_root" fetch --quiet origin main 2>/dev/null || true

base=$(git -C "$repo_root" merge-base origin/main HEAD 2>/dev/null) || exit 0

# Nothing to say about a branch that adds no migration.
git -C "$repo_root" diff --quiet "$base" HEAD -- migrations/ 2>/dev/null && exit 0

tmp=$(mktemp -d 2>/dev/null) || exit 0
trap 'rm -rf "$tmp"' EXIT

# Build the post-merge migration set as `main`'s, plus the directories this branch
# adds. That is what the merge queue produces — it rebases each entry onto the queue
# head, so the branch's new migrations are replayed on top of whatever landed while
# it waited.
#
# `git merge-tree` was the obvious way to get this and is the wrong one. Closing a
# fork means `prune-snapshots.mjs` deletes one `snapshot.json` and writes another,
# which git reads as a *rename* — so two branches that each close a fork conflict
# rename/rename on that file, and a merge simulation reports a conflict rather than
# the lineage. Failing open there would swallow precisely the case this exists for,
# and it does not even match reality: the rebase the queue actually performs applies
# cleanly, which is how #510 reached `main` in the first place.
git -C "$repo_root" archive origin/main migrations 2>/dev/null | tar -x -C "$tmp" 2>/dev/null
[ -d "$tmp/migrations" ] || exit 0

added=$(git -C "$repo_root" diff --name-only --diff-filter=A "$base" HEAD -- migrations/ 2>/dev/null |
	sed 's#^\(migrations/[^/]*\)/.*#\1#' | sort -u)

for dir in $added; do
	# One `main` already has is not this branch's to replay.
	git -C "$repo_root" cat-file -e "origin/main:$dir/migration.sql" 2>/dev/null && continue
	rm -rf "${tmp:?}/$dir"
	git -C "$repo_root" archive HEAD "$dir" 2>/dev/null | tar -x -C "$tmp" 2>/dev/null
done

# `--out` points check at the merged tree's migrations rather than the working
# copy's, and `--dialect` supplies the one field the config would otherwise be read
# for. Neither needs the CLOUDFLARE_* credentials `drizzle.config.ts` references.
#
# `$DRIZZLE_KIT_BIN` is a test seam and nothing else. The spec builds its scenarios
# in a throwaway repo, which has no `node_modules` for `pnpm exec` to resolve, so
# without it the interesting cases could only ever observe this guard failing open.
if [ -n "${DRIZZLE_KIT_BIN:-}" ]; then
	report=$("$DRIZZLE_KIT_BIN" check --dialect sqlite --out "$tmp/migrations" 2>&1)
	status=$?
else
	report=$(cd "$repo_root" && pnpm exec drizzle-kit check --dialect sqlite --out "$tmp/migrations" 2>&1)
	status=$?
fi

[ "$status" -eq 0 ] && exit 0

# Block only on the failure this guard understands. `drizzle-kit` exits non-zero for
# plenty of reasons that are not a fork — a worktree with no `node_modules` is the
# common one — and none of those should stand between a finished branch and the
# queue.
printf '%s' "$report" | grep -q 'Non-commutative migrations detected' || exit 0

# Name the offending pair. The report prints absolute paths into the temp tree; the
# directory names are what a person can act on.
pair=$(printf '%s' "$report" | grep -oE 'migrations/[0-9]{14}_[A-Za-z0-9_.-]+' | sort -u | sed 's/^/  /')

cat >&2 <<MSG
Blocked: merging this branch would fork the migration lineage on main.

$pair

Both would descend from the same parent snapshot, which is what
\`Non-commutative migrations detected\` means. Once that is on main, \`drizzle-kit
generate\` refuses to run at all and nobody can add a schema change until it is
reconciled.

The branch is fine on its own — main moved under it. Usually that means somebody
else has already landed the change this migration makes, in which case the fix is
to drop yours rather than to reconcile afterwards:

  git fetch origin
  git log --oneline --diff-filter=A --name-only origin/main -- migrations/

If it is still needed, merge main in, regenerate against the new head, and queue
again:

  git merge origin/main
  # delete only the migrations this branch added, then
  pnpm db:generate

See docs/development/conventions.md and \`migrations/*_reconcile_fork_508_510\`
for what closing one after the fact costs.
MSG
exit 2
