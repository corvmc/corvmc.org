#!/usr/bin/env bash
# SessionStart hook: put the tracker in context, cheaply.
#
# The backlog used to be CHORES.md and IDEAS.md, and the reason it moved is that
# nobody read them — the file carried a chore that had already been fixed and a
# lint-warning count that had been zero for months, both for long enough that
# two people and every agent session walked past them. Moving the prose to
# GitHub does not fix that by itself. This does: a session cannot claim not to
# know the tracker exists if the counts are already in front of it.
#
# Bug/Feature/Tech debt/Task are GitHub issue *types*, not labels: a type is
# single-select, so an issue cannot be two of them at once, which is the reason
# `tech-debt` and `enhancement` stopped being labels. `untyped` is printed when
# it is non-zero because an issue with no type is one the vocabulary missed.
#
# What it deliberately does NOT do is print the issues. A hundred titles is a
# couple of thousand tokens on every request for the whole session, which buys
# recall of a list the session has no reason to read top to bottom. The counts
# plus the query are enough to make the query happen, and the per-area rules in
# `.claude/rules/` ask for it again at the only moment it is actually useful —
# when a file in that vertical is opened. `needs-triage` is the one list printed
# in full, because it is short by construction and it is the queue a human owes
# an answer to.
#
# Fails open and silent: no `gh`, no auth, no network, no repo — a session that
# cannot reach GitHub is a session that starts normally.
set -uo pipefail

command -v gh >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# `gh` will sit on a dead network for far longer than a session should wait to
# start. `timeout` is coreutils and absent on a stock macOS; perl's alarm is on
# both. If neither exists, the call is made unguarded rather than skipped.
run_gh() {
	if command -v timeout >/dev/null 2>&1; then
		timeout 8 gh "$@"
	elif command -v perl >/dev/null 2>&1; then
		perl -e 'alarm shift; exec @ARGV' 8 gh "$@"
	else
		gh "$@"
	fi
}

issues=$(run_gh issue list --state open --limit 300 --json number,title,labels,issueType 2>/dev/null) || exit 0
[ -n "$issues" ] || exit 0
[ "$(jq 'length' <<<"$issues" 2>/dev/null || echo 0)" -gt 0 ] || exit 0

jq -r '
  def labels: [.labels[].name];
  def oftype($t): map(select(.issueType.name? == $t)) | length | "\($t) \(.)";
  def oflabel($l): map(select(labels | index($l))) | length | "\($l) \(.)";
  "Open GitHub issues: \(length). This is the backlog — CHORES.md and IDEAS.md are gone.",
  "  " + ([
      oftype("Bug"), oftype("Feature"), oftype("Tech debt"), oftype("Task"),
      (map(select(.issueType == null)) | length | "untyped \(.)")
    ] | map(select(test(" 0$") | not)) | join(" · ")),
  ([
      oflabel("spec"), oflabel("needs-area"), oflabel("flaky"), oflabel("ci-failure")
    ] | map(select(test(" 0$") | not))
    | if length == 0 then empty else "  " + join(" · ") end),
  "  Scoped by vertical: gh issue list --label area:<events|bands|money|…>",
  "  Free text:          gh issue list --state open --search '"'"'<terms>'"'"'",
  (map(select(labels | index("needs-triage"))) |
    if length == 0 then empty else
      "",
      "Awaiting a human (\(length)):",
      (.[:12][] | "  #\(.number) \(.title[:96])"),
      (if length > 12 then "  … and \(length - 12) more" else empty end)
    end),
  "",
  "A real problem found outside the change in hand is filed, not fixed and not",
  "left in the chat: search first, then `gh issue create --template finding.md`."
' <<<"$issues"
