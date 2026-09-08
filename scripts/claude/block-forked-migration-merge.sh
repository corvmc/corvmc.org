#!/usr/bin/env bash
# PreToolUse guard: refuse to queue a PR whose migrations fork the lineage once
# merged into `main`.
#
# A branch generated while `main` was at one head can be perfectly clean on its own
# and fork the lineage the moment it lands. That is not hypothetical. #508 and #510
# both closed the #501/#502 fork, in parallel, and both merged; the second re-forked
# `main` on exactly the failure the first had fixed, and blocked `pnpm db:generate`
# for everybody until #512.
#
# WHAT THIS KEYS ON, AND WHAT IT USED TO
#
# It used to ask `drizzle-kit check` about a simulated merged tree and treat exit 0
# as proof. `check` only reports a parent snapshot that has two children, and
# `prune-snapshots.mjs` keeps ONE snapshot per side — so the shared parent and every
# intermediate is gone. Three migrations against three (#672, the
# `feature/uloc-rework` reconcile) leaves two snapshots whose `prevId`s name two
# different absent parents: `check` says "Everything's fine", `db:reset` replays
# every file and passes too, and CI's `generate` step is the only thing that fails.
#
# So it now asks the two questions that describe the condition itself:
#
#   1. Did both sides add migrations since the merge base? That IS the fork — two
#      lineages off one ancestor — and it is read from git, so pruning cannot hide
#      it and no snapshot has to survive for it to be visible.
#   2. Otherwise `HEAD` already contains all of `main`, so the branch's tree is the
#      merged tree: run `drizzle-kit generate` against it, exactly as CI's "Verify
#      schema changes have a committed migration" step does. Anything but a no-op
#      means the committed migrations do not describe the schema.
#
# Deliberately at `gh pr merge` and nowhere near `db:generate`. Generating a
# migration on a local branch is ordinary work and stays unguarded — a branch is
# allowed to hold an unmerged migration for as long as it likes. The question this
# asks is only ever "is it still safe to land *now*", which is the one moment the
# answer can have changed without anybody touching the branch.
#
# It still fails open everywhere it cannot be sure — a guard that blocked on its own
# breakage would leave the branch unqueueable with nothing to fix — but it now says
# so on stderr instead of exiting 0 in silence, which is the other half of #672: a
# skipped run and a clean one were indistinguishable. Exit 2 blocks the call.
set -uo pipefail

# Every fail-open path announces itself. Silence is reserved for "there was nothing
# to evaluate": not a merge command, or no migrations of this branch's own.
note() { printf 'block-forked-migration-merge: %s\n' "$1" >&2; }

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
[ -n "$repo_root" ] || exit 0

# Unresolvable `origin/main` fails open, as in `block-shipped-migration-delete.sh`:
# a clone that never fetched it gets no guard rather than a blanket refusal.
if ! git -C "$repo_root" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
	note 'not evaluated: no origin/main to compare against.'
	exit 0
fi

# Refresh first. The whole point is that `main` may have moved since this branch was
# cut, and a stale remote-tracking ref would answer the question as it stood when the
# collision was still invisible.
git -C "$repo_root" fetch --quiet origin main 2>/dev/null ||
	note 'origin/main could not be refreshed; answering from the ref on disk.'

if ! base=$(git -C "$repo_root" merge-base origin/main HEAD 2>/dev/null); then
	note 'not evaluated: no merge base with origin/main.'
	exit 0
fi

# Migration directories a ref has added since the merge base.
added_dirs() {
	git -C "$repo_root" diff --name-only --diff-filter=A "$base" "$1" -- migrations/ 2>/dev/null |
		sed 's#^\(migrations/[^/]*\)/.*#\1#' | sort -u
}

# A directory the other ref also has is the same migration, not a second lineage.
not_on() {
	local ref=$1 dir
	while read -r dir; do
		[ -n "$dir" ] || continue
		git -C "$repo_root" cat-file -e "$ref:$dir/migration.sql" 2>/dev/null || printf '%s\n' "$dir"
	done
}

branch_added=$(added_dirs HEAD | not_on origin/main)

# Nothing to say about a branch that adds no migration of its own.
[ -n "$branch_added" ] || exit 0

main_added=$(added_dirs origin/main | not_on HEAD)

indent() { printf '%s\n' "$1" | sed 's/^/    /'; }

fork_message() {
	cat >&2 <<MSG
Blocked: merging this branch would fork the migration lineage on main.

  $1
$(indent "$2")

  this branch adds:
$(indent "$branch_added")

Two lineages descending from one ancestor. Once that is on main, \`drizzle-kit
generate\` diffs the schema against ONE snapshot — the newest by path — which has
never seen the other side's tables, so CI's "Verify schema changes have a committed
migration" step goes red and nobody can add a schema change until it is reconciled.
\`drizzle-kit check\` and \`pnpm db:reset\` can both pass in this state: only one
snapshot per side survives pruning, so the parent that would make the fork visible
is not on disk to be compared.

Check first whether somebody already landed the change this makes — then dropping
yours is the fix, rather than reconciling afterwards:

  git log --oneline --diff-filter=A --name-only origin/main -- migrations/

If it is still needed, collapse this branch's own migrations and regenerate on top
of the other side's snapshot. One new migration, not a merge of two lineages:

  git merge origin/main
  # delete ONLY the directories listed under "this branch adds" above, then
  pnpm db:generate
  pnpm db:reset   # prove the collapsed lineage replays

See docs/development/conventions.md#long-lived-feature-branches and
\`migrations/*_reconcile_fork_508_510\` for what closing one after the fact costs.
MSG
}

if [ -n "$main_added" ]; then
	fork_message 'main has added since this branch left it:' "$main_added"
	exit 2
fi

# From here `HEAD` contains everything `origin/main` has, so the branch's own tree is
# the merged tree and CI's question can be asked of it directly.
tmp=$(mktemp -d 2>/dev/null)
if [ -z "$tmp" ] || [ ! -d "$tmp" ]; then
	note 'not evaluated: could not create a temp directory.'
	exit 0
fi
trap 'rm -rf "$tmp"' EXIT

# The post-merge migration set is `main`'s plus the directories this branch adds —
# what the queue produces, since it rebases each entry onto the queue head.
#
# `git merge-tree` was the obvious way to get this and is the wrong one: closing a
# fork rewrites `snapshot.json`, which git reads as a rename, so two such branches
# conflict rename/rename and a merge simulation reports a conflict rather than a
# lineage. The rebase the queue actually performs applies cleanly.
git -C "$repo_root" archive origin/main migrations 2>/dev/null | tar -x -C "$tmp" 2>/dev/null
archived=("${PIPESTATUS[@]}")
if [ "${archived[0]}" -ne 0 ] || [ "${archived[1]}" -ne 0 ] || [ ! -d "$tmp/migrations" ]; then
	note "not evaluated: could not read origin/main's migrations (git archive ${archived[0]}, tar ${archived[1]})."
	exit 0
fi

for dir in $branch_added; do
	rm -rf "${tmp:?}/$dir"
	git -C "$repo_root" archive HEAD "$dir" 2>/dev/null | tar -x -C "$tmp" 2>/dev/null
	if [ ! -d "$tmp/$dir" ]; then
		note "not evaluated: could not read $dir from HEAD."
		exit 0
	fi
done

# `--out` points drizzle-kit at the merged tree rather than the working copy's, and
# the explicit flags supply what `drizzle.config.ts` would otherwise be read for —
# including its own `out`, which would write into the real `migrations/`. None of
# them needs the CLOUDFLARE_* credentials that config references.
#
# `$DRIZZLE_KIT_BIN` is a test seam and nothing else. The spec builds its scenarios
# in a throwaway repo, which has no `node_modules` for `pnpm exec` to resolve, so
# without it the interesting cases could only ever observe this guard failing open.
drizzle_kit() {
	if [ -n "${DRIZZLE_KIT_BIN:-}" ]; then
		(cd "$repo_root" && "$DRIZZLE_KIT_BIN" "$@" </dev/null 2>&1)
	else
		(cd "$repo_root" && pnpm exec drizzle-kit "$@" </dev/null 2>&1)
	fi
}

report=$(drizzle_kit check --dialect sqlite --out "$tmp/migrations")
status=$?

if [ "$status" -ne 0 ]; then
	# The report prints absolute paths into the temp tree; the directory names are
	# what a person can act on.
	if printf '%s' "$report" | grep -q 'Non-commutative migrations detected'; then
		pair=$(printf '%s' "$report" | grep -oE 'migrations/[0-9]{14}_[A-Za-z0-9_.-]+' | sort -u)
		fork_message 'drizzle-kit check reports these as siblings:' "$pair"
		exit 2
	fi
	note 'not evaluated: drizzle-kit check failed for a reason that is not a fork.'
	printf '%s\n' "$report" | sed 's/^/  /' >&2
	exit 0
fi

# `check` passing is not evidence the lineage is intact — see the header. This is,
# and it is the question CI asks: has `generate` still got something to emit?
schema=$(sed -n "s#^[[:space:]]*schema:[[:space:]]*['\"]\([^'\"]*\)['\"].*#\1#p" \
	"$repo_root/drizzle.config.ts" 2>/dev/null | head -1)
schema=${schema:-./src/lib/server/db/schema/index.ts}

# An uncommitted schema edit is not in the PR, so generating against it would block
# on a change CI is never going to see.
if [ -n "$(git -C "$repo_root" status --porcelain -- "${schema%/*}" 2>/dev/null)" ]; then
	note 'generate not run: the schema directory has uncommitted changes.'
	exit 0
fi

before=$(ls "$tmp/migrations")
report=$(drizzle_kit generate --dialect sqlite --driver d1-http --schema "$schema" --out "$tmp/migrations")
status=$?

if [ "$status" -ne 0 ]; then
	note 'not evaluated: drizzle-kit generate failed.'
	printf '%s\n' "$report" | sed 's/^/  /' >&2
	exit 0
fi

emitted=$(comm -13 <(printf '%s\n' "$before") <(ls "$tmp/migrations"))
[ -n "$emitted" ] || exit 0

sql=$(for dir in $emitted; do head -20 "$tmp/migrations/$dir/migration.sql" 2>/dev/null; done)

cat >&2 <<MSG
Blocked: this branch's committed migrations do not describe its schema, so merging
it turns CI's "Verify schema changes have a committed migration" step red.

\`drizzle-kit generate\` still has this to emit against the merged tree:

$(indent "$sql")

That is what main would be missing. It usually means main's migrations were merged
in but this branch's own were never collapsed onto them: \`generate\` diffs against
ONE snapshot, the newest by path, and when that one is main's it has never seen this
branch's tables. \`drizzle-kit check\` and \`pnpm db:reset\` both pass in that state,
which is why this is the check that runs.

Collapse and regenerate — one migration on top of main's snapshot:

  git merge origin/main
  # delete only the migrations this branch added:
$(printf '%s\n' "$branch_added" | sed 's/^/  #   /')
  pnpm db:generate
  pnpm db:reset   # prove the collapsed lineage replays

See docs/development/conventions.md#long-lived-feature-branches.
MSG
exit 2
