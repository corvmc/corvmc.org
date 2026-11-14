# queue-triage

Pick up PRs the merge queue rejected and decide, per PR, whether to re-queue.

`.github/workflows/merge-queue-guard.yml` labels every rejected PR `queue-rejected` and comments
what failed. Nothing re-arms auto-merge — that is this command's job.

$ARGUMENTS

## Find the work

```bash
gh queue sweep
```

`gh queue` is a user-level extension (`gh extension install DevonCash/gh-queue`). It sweeps your
open PRs in every repo, plus every open PR here, bots included, while `corvmc/corvmc.org` is listed
in `~/.config/gh-queue/repos`. It reports each PR that is **rejected** (labelled, or removed from
the queue with nothing re-arming it), **stuck** (armed, but a required check is red on its own head
or it conflicts with `main` — the queue never saw it, so the guard never labelled it), or
**unarmed** (yours, ready, nobody armed it). `nothing stranded` means stop. A `default branch is
red` line means a rejection may be `main`'s fault, not the PR's: read the `ci-failure` issue before
blaming the diff.

The launchd job from `gh queue install` runs the same sweep every 15 minutes and posts a macOS
notification for each new entry, so this command is usually opened from one.

**The label is the signal; the armed flag is not.** GitHub consumes the auto-merge request when a
PR _enters_ the queue, so `gh pr view <n> --json autoMergeRequest` returns `null` for the whole
~8 minutes a healthy PR is mid-run. Acting on that reading means firing `gh pr merge --auto` at a
PR that is already queued.

| Reading                                             | Means                                             |
| --------------------------------------------------- | ------------------------------------------------- |
| unarmed + `added_to_merge_queue`, no later `merged` | running — leave it alone                          |
| unarmed + `queue-rejected` label + guard comment    | rejected                                          |
| `removed_from_merge_queue` with nothing after it    | rejected                                          |
| armed + `BLOCKED`                                   | still on its own PR-head checks, not enqueued yet |

When a PR arrives without the label — the user names it, or a watch caught it flipping — read the
timeline before triaging it:

```bash
gh api repos/corvmc/corvmc.org/issues/<N>/timeline --jq '.[] | select(.event) | .event'
```

## Per PR

**Read the guard's own comment first.** It names the failing tests (from GitHub's
annotations), links the `e2e-failures-<run>-<attempt>` artifact holding the traces and
`error-context.md`, and prints how many times the queue has ejected this PR. That is usually the
whole diagnosis, and the steps below are the fallback for a PR whose comment predates it — or the
long way round when the annotations block came back empty.

1. Find the run. The queue ref is deleted on dequeue, so match on the branch name the run
   recorded rather than looking up a ref:

   ```bash
   gh run list --repo corvmc/corvmc.org --event merge_group --limit 50 \
     --json databaseId,headBranch,conclusion,url \
     --jq '[.[] | select(.conclusion == "failure" and (.headBranch | contains("/pr-<N>-")))] | first'
   ```

2. Read the failing job's log — `gh run view <id> --log-failed` — and count how many times this PR
   has already been round-tripped: `gh api repos/corvmc/corvmc.org/issues/<N>/timeline` and count
   `removed_from_merge_queue`.

3. Classify honestly. It failed on the queue ref, tested against the queue head, so "green on the
   PR's own head" is not evidence of anything.
   - **Never re-run or re-queue unchanged to get green.** No flaky tests in main: a flake is
     grounds for rejection, and CI fails E2E on any test that passed only on a retry.
   - **A flake** (fails without the PR's diff being the cause) — diagnose it from the log and
     traces, file it with the `flaky` label (search `gh issue list --state open --label flaky`
     first), fix it in its own PR, and re-queue the blocked PR with `gh pr merge --auto` only once
     that fix has merged. The guard's `enqueued` job clears the label.
   - **A real failure in the PR** — leave it labelled and report the diagnosis, or fix it on the
     branch. A test that fails on the queue head and nowhere else is an ordering bug more often
     than it is bad luck.
   - **No failed run at all** (manual removal, conflict, or the queue's one-hour check timeout) —
     say which, and ask before re-queueing.

A **stuck** PR is not a queue rejection: its own checks failed before it could enter. Read the
failing job the sweep links, fix a real failure on the branch, and push; a conflict is a rebase
onto `main` and a force-push. Either way, wait for the new head's checks to start before re-arming
— arming straight after a force-push queues on the old head's checks and gets the PR ejected.
**Unarmed**: arm it if it is finished, or ask. Every arm and re-arm runs the pre-arm check first.

A job that **never started** is not a red check. Its signature: conclusion `cancelled`, an
annotation that it exceeded `timeout-minutes`, a reported duration about five minutes past that
limit, no log (`BlobNotFound`), and no steps at all:

```bash
gh api repos/corvmc/corvmc.org/actions/jobs/<job-id> --jq '.steps | length'   # 0
```

The runner took the job and never ran "Set up job", so no code was checked and there is no result
to overturn. Re-run that one job (`gh run rerun <run-id> --job <job-id>`); that is not re-running to
get green. A timeout with steps is the job itself and gets diagnosed (#2877).

Never `--admin` and never `gh pr update-branch` — both defeat the queue. See `CLAUDE.md`.

## Before arming, and after every ejection

```bash
node scripts/claude/pre-arm-check.mjs <N>
```

It merges the PR's pushed head, in memory (`git merge-tree --write-tree`), against `main` and
against every PR in the merge queue or armed for auto-merge. The queue drops a PR that conflicts
with one merged ahead of it as UNMERGEABLE, with no run and no guard comment, so this is the only
place that conflict shows before it costs a queue slot. Its exit code is the policy:

| Exit | Means                                                                                 | Do                                                                                       |
| ---- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 0    | clear                                                                                 | arm                                                                                      |
| 1    | conflicts with `main`                                                                 | rebase onto `main`, push, wait for the new checks to start, check again                  |
| 2    | conflicts with one queued or armed PR                                                 | rebase onto that PR's head (stack), push, wait for checks, arm; keep the unstack command |
| 2    | conflicts with several, or with one that `main` has since moved past in the same file | wait for them to merge, then rebase onto `main`                                          |
| 3    | stacked on a PR that left the queue without merging                                   | `git rebase --onto origin/main <its head>`, push, check again                            |
| 4    | usage, `git` or `gh` error                                                            | read the message                                                                         |

A stacked PR keeps `main` as its base, so the queue still takes it. If its base PR leaves the queue
unmerged, arming the stack would carry the base's commits into `main`, which is why every re-arm
after an ejection runs the check first. An armed PR that itself conflicts with `main` cannot enter
the queue; the check skips it rather than offer it as a base.

## Watch mode

To follow one PR, run `gh queue await <N>` with `run_in_background`. It exits
when the PR merges (0), is rejected (1, printing the guard's comment), is stuck before the queue
(3, with the failing jobs), is closed or disarmed (4), or times out (2). The session is woken on
exit; no polling loop is needed.
