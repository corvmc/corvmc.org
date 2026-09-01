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
BASE=$(git merge-base "$BASE_REF" HEAD)

# ESLint only understands the code globs.
CODE=$(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD -- '*.ts' '*.js' '*.svelte')

# Prettier formats far more than that. Checking only the code globs here let an
# unformatted .md through a green PR and turned `Lint (full)` red on main right
# after the merge, which is the one place nobody is watching for it.
FORMATTABLE=$(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD -- \
	'*.ts' '*.js' '*.svelte' '*.md' '*.json' '*.css' '*.html' '*.yml' '*.yaml')

if [ -z "$CODE" ] && [ -z "$FORMATTABLE" ]; then
	echo "No changed files to lint"
	exit 0
fi

if [ -n "$CODE" ]; then
	echo "Linting changed files:"
	echo "$CODE" | sed 's/^/  /'
	# shellcheck disable=SC2086
	eslint $CODE
fi

if [ -n "$FORMATTABLE" ]; then
	echo "Checking formatting:"
	echo "$FORMATTABLE" | sed 's/^/  /'
	# Deleted-then-recreated paths and files ignored by .prettierignore are fine;
	# --no-error-on-unmatched-pattern keeps those from failing the run.
	# shellcheck disable=SC2086
	prettier --check --no-error-on-unmatched-pattern $FORMATTABLE
fi
