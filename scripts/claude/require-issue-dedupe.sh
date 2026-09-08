#!/usr/bin/env bash
# PreToolUse guard: search the tracker before adding to it.
#
# A session files a finding with no memory of what it filed before and no reason
# to assume the repo already knows — so the duplicate is the default outcome,
# not the unlucky one. This makes the search a precondition of the create rather
# than a line of prose that competes with everything else in context.
#
# A search arms a marker for this session; a create requires a fresh one. The
# matcher, the 30-minute window, and the two limits it does not close are in
# `lib/issue-dedupe.mjs`. There is deliberately no escape hatch — a search that
# fails still arms the marker, so this cannot strand an offline session.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
[ "$(node "$here/lib/issue-dedupe.mjs" 2>/dev/null)" = 'block' ] || exit 0

cat >&2 <<'MSG'
Blocked: search the tracker before opening an issue.

Nothing in this session has looked at the existing issues, so there is no way to
know whether this one is already open. Search for the terms someone else would
have used, then file:

  gh issue list --state open --search '<terms>'
  gh issue list --label area:<vertical>          # the labels are per-vertical
  gh issue create --template finding.md ...

If it is already there, comment on it instead — a second issue costs the reader
more than the duplicate saved you.
MSG
exit 2
