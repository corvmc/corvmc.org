# NNNN A committed manifest keeps cron monitors in step with the schedule

- **Date:** 2026-09-29
- **Status:** Accepted
- **Issue:** [#1327](https://github.com/corvmc/corvmc.org/issues/1327); built in #1732; owner
  confirmation asked in [#1717](https://github.com/corvmc/corvmc.org/issues/1717)

## Context

A Sentry cron monitor is created by the first check-in that names its slug. The check-in API
authenticates with the DSN alone and cannot disable or delete a monitor. When #1198 folded four
endpoints into `/api/cron/reminders`, their monitors raised "missed check-in" every run until
someone disabled them by hand (#1329). The slug was derived inline in `runScheduledJobs`, so a
rename would orphan a monitor the same way.

## Decision

1. **`monitorSlug(path)` in `src/lib/server/cron/schedule.ts` is the one slug rule.** The runner
   and the spec both call it.
2. **`CRON_MONITORS` lists every slug that has ever had a monitor**, as `'live'` or
   `{ retired, ref }`. Entries are never deleted.
3. **`schedule.spec.ts` fails when the manifest and `CRON_SCHEDULE` disagree**, when two paths
   share a slug, and when a retired slug is scheduled again. Its message tells the author to
   disable the monitor in Sentry.
4. **Disabling the monitor stays a manual Sentry step**, described in the operations manual under
   "Retiring a cron job".

## Alternatives rejected

- **Reconcile at deploy time.** A script on the deploy command would list monitors and disable
  any slug not scheduled. It needs a long-lived token with `alerts:write` as a build secret and a
  Sentry API call on the publish path. The repo had one removal in its history.
- **Document the manual step only.** Nothing would prompt the author at the moment the context
  exists. That is how #1198 left four monitors alerting.

## Consequences

- A retired monitor alerts from merge until someone with Sentry write access disables it. The
  manifest names it, with a date and a reference.
- Agent sessions cannot do the Sentry step. The PR names the slug for someone who can.
- A retired slug cannot be reused, because a disabled monitor records no check-ins.
- Deleting a schedule entry and its manifest entry in one PR still passes. The manifest prompts;
  it does not lock.
