# Cron monitor manifest

> ## Status
>
> ✅ Built in #1732 (#1327). The choice of a committed manifest over a deploy-time reconcile
> is for the owner to confirm in #1717.

## Purpose

A Sentry cron monitor is created by the first check-in that names its slug, and nothing ever
removes it. When an endpoint leaves `CRON_SCHEDULE`, or is renamed, its monitor keeps expecting
check-ins that cannot arrive and raises "missed check-in" every run until a person disables it.

This spec makes removing a monitored slug a change the author has to acknowledge in the same PR.
The repo keeps a manifest of every slug that has ever had a monitor. A unit spec fails when the
manifest and `CRON_SCHEDULE` disagree, and its failure message tells the author to disable the
monitor in Sentry.

## Premise, checked against `main` on 2026-09-29

Checked at `752d940`.

- **Monitors are upserted, never removed.** `createSentryCheckIn` sends `monitor_config` on every
  `in_progress` check-in (`src/lib/server/cron/sentry-check-in.ts`), which creates or updates the
  monitor. That has been true since #141 (2026-07-29). The check-in API is authenticated by the
  DSN alone, and it has no way to disable or delete a monitor.
- **The slug is derived inline.** `runScheduledJobs` computes `path.split('/').at(-1)`, so a
  rename orphans the old monitor and creates a new one.
- **The one removal so far left four ghosts.** #1198 (2026-09-17) folded `shift-feedback`,
  `reservation-reminders`, `shift-reminders` and `confirmation-reminders` into `/api/cron/reminders`.
  Their monitors alerted for days (#1329) until the owner disabled them by hand.
- **`schedule.spec.ts` already pins the schedule** to `wrangler.toml`, both docs tables and a
  hand-kept `ALL_ENDPOINTS` list. None of those checks says anything about slugs that have gone.
- **The operations manual says the opposite.** Its Monitoring paragraph reads "nothing to
  configure in the Sentry dashboard". That holds for adding a job and is false for removing one.

## The handoff

1. **A developer removes or renames an endpoint** in `CRON_SCHEDULE`.
2. **CI tells them** that the slug still exists in the manifest as live. This is the only point
   where the person holding the context is still around.
3. **The developer marks the slug retired** in the same PR, with a date and the PR or issue that
   retired it.
4. **Somebody with Sentry access disables the monitor.** This is a dashboard action (see
   [Operations](#3-operations-manual)). An agent session cannot do it, because the Sentry connector
   has no `alerts:write`. So the PR body names the slug for the owner.

Step 4 stays manual. The manifest makes the owed action visible at the moment it arises. It does not
perform the action.

## The design

### 1. One slug function

`schedule.ts` exports `monitorSlug(path: string): string`, the existing basename rule.
`runScheduledJobs` calls it in place of the inline expression, so the runner and the spec cannot
derive slugs differently. The module keeps its no-`$app` constraint. It is bundled outside the kit
build.

### 2. `CRON_MONITORS`, next to `CRON_SCHEDULE`

```ts
type RetiredMonitor = { retired: string /* YYYY-MM-DD */; ref: string /* '#1198' */ };
export const CRON_MONITORS: Record<string, 'live' | RetiredMonitor> = {
	'send-campaigns': 'live',
	// …one 'live' entry per slug in CRON_SCHEDULE…
	'shift-feedback': { retired: '2026-09-17', ref: '#1198' },
	'reservation-reminders': { retired: '2026-09-17', ref: '#1198' },
	'shift-reminders': { retired: '2026-09-17', ref: '#1198' },
	'confirmation-reminders': { retired: '2026-09-17', ref: '#1198' }
};
```

Entries are never deleted. A retired entry is the repo's record that a monitor under that slug
exists in Sentry, disabled.

### 3. Operations manual

In `docs/architecture/operations-manual.md`, change the Monitoring paragraph so that "nothing to
configure" applies only to adding and rescheduling a job. Add a short **Retiring a cron job** step:

- Mark the slug retired in `CRON_MONITORS`.
- In Sentry → Insights → Crons → the monitor, choose **Disable**, not Delete. Disabling keeps the
  monitor's history and stops both check-ins and alerts. This needs a Sentry member with write
  access to the `javascript-sveltekit` project, and no token.
- Resolve any open `Cron failure: <slug>` issue.

To do the same through the API, use a **user auth token or internal integration token with
`alerts:write`** (`project:write` also works) against
`PUT /api/0/organizations/corvallis-music-collective/monitors/<slug>/`. Send it with
`status: "disabled"`. An organization auth token (`sntrys_…`, scope `org:ci`) cannot do this.
Neither can the build plugin's `.env.sentry-build-plugin` token or the claude.ai Sentry connector.

## Tests

Added to `src/lib/server/cron/schedule.spec.ts`. Each message states the fix:

| Rule                                                                      | Failure message says                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Every path in `CRON_SCHEDULE` maps to a `'live'` entry                    | add `'<slug>': 'live'` to `CRON_MONITORS`                            |
| Every `'live'` entry maps to a path in `CRON_SCHEDULE`                    | mark `<slug>` retired, and disable its Sentry monitor (manual link)  |
| No two paths share a slug                                                 | two jobs would report to one monitor                                 |
| No retired slug is scheduled again                                        | a disabled monitor records no check-ins, so pick a new endpoint name |
| A retired entry's `retired` is an ISO date and `ref` matches `^#\d+$`     | —                                                                    |
| `runScheduledJobs` opens its check-in with `monitorSlug(path)` for a path | — (the existing bracketing test switches to the exported function)   |

The fourth rule is there because a disabled monitor stops recording check-ins. Sentry's docs say
this of pausing, which is what the dashboard's Disable does. Reusing a retired name would bring back
a job that nothing monitors, and no error would say so.

## Phases

One PR: `monitorSlug`, `CRON_MONITORS` seeded with the seventeen live slugs and the four retired
ones, the spec rows above, and the manual change. It adds no schema and no route, and needs no
secret or dashboard change.

## Out of scope

- **A deploy-time reconciler.** Nothing in the build or deploy command calls the Sentry API.
- **Monitor environments other than `production`.** The manifest is about slugs. A local
  `--test-scheduled` run already reports under `SENTRY_ENVIRONMENT=development`.
- **Alert routing** (#570, #571), which is Sentry-side configuration.
