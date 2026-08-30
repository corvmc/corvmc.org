# queue-triage

Pick up PRs the merge queue rejected and decide, per PR, whether to re-queue.

`.github/workflows/merge-queue-guard.yml` labels every rejected PR `queue-rejected` and comments
what failed. Nothing re-arms auto-merge — that is this command's job.

$ARGUMENTS

## Find the work

```bash
gh pr list --repo corvmc/corvmc.org --label queue-rejected --state open \
  --json number,title,headRefName
```

Empty output means nothing is stranded. Say so and stop.

## Per PR

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
   - **A known CI-only flake** — `volunteering.e2e.ts` is the documented one — re-queue with
     `gh pr merge --auto`. The guard's `enqueued` job clears the label.
   - **Anything else, including a flake that has now failed three or more times** — leave it
     labelled, report the diagnosis to the user, and do not re-queue. A test that fails on the
     queue head and nowhere else is a real ordering bug more often than it is bad luck.
   - **No failed run at all** (manual removal, conflict, or the queue's one-hour check timeout) —
     say which, and ask before re-queueing.

Never `--admin` and never `gh pr update-branch` — both defeat the queue. See `CLAUDE.md`.

## Watch mode

When the user asks to keep watching, arm a persistent `Monitor` so an open session hears about a
rejection within a minute instead of waiting to be asked. The label is the durable half: a session
started hours later still finds everything the watch slept through.

```bash
prev=""
while true; do
  cur=$(gh pr list --repo corvmc/corvmc.org --label queue-rejected --state open \
    --json number,title --jq '.[] | "PR #\(.number) rejected by the queue: \(.title)"' \
    2>/dev/null | sort || true)
  comm -13 <(echo "$prev") <(echo "$cur")
  prev=$cur
  sleep 60
done
```
