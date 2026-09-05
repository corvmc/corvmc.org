#!/usr/bin/env bash
# Lint only the files changed relative to the branch this work merges into — fast
# feedback on feature branches. The full `pnpm lint` still runs on merge to main to
# catch errors in untouched files.
set -euo pipefail

# `BASE_REF` is the branch this work merges into. CI passes the PR's own base so a
# phase PR into an integration branch is diffed against that branch, not against
# `main` — otherwise the changed-file set grows with every phase already merged and
# "Lint (changed)" eventually goes red on your PR for a file a sibling phase touched.
# Push, merge_group and local runs keep `origin/main`.
BASE_REF=${BASE_REF:-origin/main}

# A Claude Code cloud session clones the repo fresh and may not have the base ref
# locally at all, in which case `merge-base` dies under `set -e` with git's own
# "Not a valid object name" and nothing to act on. Fetch it once before giving up.
# Deliberately not a fail-open: CI's "Lint (changed)" is a required check, and a
# run that quietly linted nothing would report success for code nobody linted.
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
	echo "$BASE_REF is not present locally — fetching it"
	git fetch --quiet origin "${BASE_REF#origin/}" || true
	git rev-parse --verify --quiet "$BASE_REF" >/dev/null || {
		echo "Cannot resolve $BASE_REF even after fetching origin/${BASE_REF#origin/}." >&2
		echo "Set BASE_REF to a ref this checkout has, or fetch it." >&2
		exit 1
	}
fi

BASE=$(git merge-base "$BASE_REF" HEAD)

# ESLint only understands the code globs. `.mjs`/`.cjs` are listed explicitly:
# eslint lints them by default and the repo owns several (`scripts/**/*.mjs`), but
# a glob of '*.js' does not match them, so every one of them was invisible here.
CODE=$(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD -- \
	'*.ts' '*.js' '*.mjs' '*.cjs' '*.svelte')

# Prettier formats far more than that. Checking only the code globs here let an
# unformatted .md through a green PR and turned `Lint (full)` red on main right
# after the merge, which is the one place nobody is watching for it. `.mjs` was
# the same hole a second time — missing from BOTH lists rather than just this one,
# so a repo-owned script could break formatting *and* lint on a green PR.
#
# Two other lists have to name the same extensions: lefthook.yml's pre-commit
# prettier glob and the `case` in scripts/format-edited-file.sh. Keep all three
# in step.
FORMATTABLE=$(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD -- \
	'*.ts' '*.js' '*.mjs' '*.cjs' '*.svelte' '*.md' '*.json' '*.css' '*.html' '*.yml' '*.yaml')

if [ -z "$CODE" ] && [ -z "$FORMATTABLE" ]; then
	echo "No changed files to lint"
	exit 0
fi

if [ -n "$CODE" ]; then
	echo "Linting changed files:"
	echo "$CODE" | sed 's/^/  /'
	# `--max-warnings 0`, same as the full run. There is no grandfathered backlog
	# left to trip over: the tree is at zero, so any warning here is one the PR
	# introduced. An earlier version of this comment argued for leaving the cap
	# off because a whole-file lint would fail a PR for warnings it did not add —
	# true while a backlog existed, moot now that none does.
	# `--no-warn-ignored` because this list comes from git, not a glob, so it can
	# name a file `eslint.config.js` deliberately ignores — `worker-configuration.d.ts`
	# is generated and ignored there. Passing an ignored file explicitly makes
	# eslint warn rather than skip it, and `--max-warnings 0` turns that warning
	# into a failed PR for a file it was told not to lint.
	# shellcheck disable=SC2086
	eslint --max-warnings 0 --no-warn-ignored $CODE
fi

if [ -n "$FORMATTABLE" ]; then
	echo "Checking formatting:"
	echo "$FORMATTABLE" | sed 's/^/  /'
	# Deleted-then-recreated paths and files ignored by .prettierignore are fine;
	# --no-error-on-unmatched-pattern keeps those from failing the run.
	# shellcheck disable=SC2086
	prettier --check --no-error-on-unmatched-pattern $FORMATTABLE
fi
