# Reporting — Spec

## Purpose

There is exactly one report in this app. `/staff/volunteer/report` takes a date range and answers
four questions about approved volunteer hours; everything else called a "report" is either a stat
strip bolted onto a domain page, a nav badge count, or a filterable ledger. That one page is also
the only place in the codebase that knows how to range-filter in club time, bucket rows by month,
or compute a percent-of-total, and it hand-rolls its own date inputs and URL sync to do it.

Three things now pull on that vacuum at once:

- **The annual report.** `IDEAS.md`'s Annual Report Generator wants events held, members active,
  volunteer hours and revenue in one packet for the board and funders.
- **More module reports.** `volunteering-spec.md` defers CSV export explicitly, "because there is
  no CSV endpoint anywhere in this app yet, and the first one should set the pattern deliberately
  rather than as a sub-bullet of this feature". `production-workflow-spec.md` designs a settlement
  CSV. `email-marketing-spec.md` and `directory-profiles-spec.md` both defer analytics.
- **Product usage analytics.** Unanswerable today: `src/app.html` carries no beacon, there is no
  event table, and Sentry (errors and traces) is the only telemetry.

Twelve business workflows are documented in `business-workflows.md`, with `groups` and
`productions` designed and unbuilt on top. Whatever shape the second report takes gets copied a
dozen times, so it is worth deciding once.

This spec covers **how reports are built and where they live**. It does not survey analytics
vendors or charting libraries — those verdicts are durable and live in
`docs/development/conventions.md#dependency-posture` and `IDEAS.md`'s library tables, because a
spec is retired into `docs/specs/shipped/` once it ships and a tooling decision should outlive it.

## The rule

> **A report belongs in the app only when it joins data no single vendor holds.**
> If one vendor owns all of it, use that vendor's reporting. If the answer needs member, band or
> reservation identity attached, it is ours.

This is already how the codebase behaves; it has simply never been written down. `payment_cache`
exists precisely to hang Stripe payments off `user.id` and `reservation.id`, which Stripe cannot
do. `finance-spec.md` calls the Stripe dashboard "the single view of all revenue" and means
revenue, not per-member breakdowns. The rule generalises both.

The corollary matters as much: **a question asked once does not need a page.**
`wrangler d1 export --remote` produces a SQLite file that DuckDB, Metabase or any spreadsheet
reads. Reach for that before building a report nobody has asked for twice.

## Decisions

- **Module-owned reports over shared primitives.** Not a centralized reporting system, and not
  per-module ad hoc. Each module keeps its own `*-report-service.ts` computing its own aggregates;
  what is shared is a small kit of range, bucketing and CSV helpers, plus one filter component.
  A registry, a generic query builder, a saved-report builder or a `report` table would all be
  built on speculation — there is no second consumer for any of them, and the first one to appear
  can be served by adding to the kit.

- **The kit is `src/lib/server/report/`, and it is small.**

  | File        | Contents                                                                                                            | Generalises                                          |
  | ----------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
  | `range.ts`  | `ReportRange` and `rangeCondition(column, range)`, built on `buildDateInTz` and `DEFAULT_TIMEZONE`                  | `approvedIn()`, `volunteer-report-service.ts`        |
  | `bucket.ts` | `monthBucket(column)` / `dayBucket(column)` wrapping the `strftime(…, 'unixepoch')` fragment                        | The single instance in `volunteer-report-service.ts` |
  | `csv.ts`    | A wrapper over `csv-stringify/browser/esm/sync` with `escape_formulas` forced on, plus `csvResponse(filename, csv)` | Nothing — this is the first CSV in the app           |

  `volunteer-report-service.ts` refactors onto the kit and stays the reference implementation. Its
  separate `count(distinct userId)` count-query is a correctness detail, not a stylistic one: a
  plain `count()` under `GROUP BY` counts log rows and inflates `totalPages`. Preserve it.

- **CSV escaping gets a library, and the reason is security, not convenience.** `csv-stringify`
  has no runtime dependencies and ships `csv-stringify/browser/esm/sync`, a real ESM build with no
  Node streams, which is the part that matters in a Worker. The reason to take the dependency at
  all is `escape_formulas`: every report we would export is full of user-authored text — member
  and band names, volunteer hour comments, suggestion titles — staff will open the file in Excel,
  and **CSV formula injection** is a real vulnerability class. Neither `csv-stringify` nor
  PapaParse escapes a leading `=`, `+`, `-` or `@` by default; both make it opt-in. A hand-rolled
  `toCsv` would get the quoting right and this wrong. **The wrapper forces the flag on** rather
  than exposing it as an option, so no call site can forget it.

- **The date-range filter is `bits-ui`, which is already installed.** `bits-ui` ships
  `DateRangePicker` and `range-calendar`, and is already the headless base for `Avatar`, `Button`,
  `Modal`, `TabBar` and `Combobox`; `@internationalized/date` is already a direct dependency. A
  shared `DateRangeFilter.svelte` styles it with daisyUI and composes into the existing
  `FilterBar`, replacing the hand-rolled `<input type="date">` pair on the volunteer report. It
  keeps that page's URL sync via local `$state` plus `goto(url, { replaceState: true })` —
  `replaceState()` from `$app/navigation` updates neither `page.url` nor the router's own state.

- **Sorting a report means a server-side sort parameter, not a table library.** `ui-patterns.md`
  is explicit that `Table` has no sorting on purpose: "No `query()` accepts a sort parameter, and a
  `Table` that knows about sorting is the first step back toward the component this replaced. If a
  page genuinely needs it, add `sort`/`dir` to _that page's_ filter schema and give it its own
  header control." That prescription is right for reports specifically, because report tables are
  **server-paginated** — `paginate()` defaults to 50 rows. A client-side table library would sort
  the 50 rows on screen rather than the 250 in the result set, which is a wrong answer rather than
  a missing feature. TanStack Table's Svelte 5 adapter is not the issue; the shape is.

- **The annual report owns no aggregation of its own.** `annual-report-service.ts` calls each
  module's existing report service — `getVolunteerTotals()`, `getCommunityStats()`, event and
  ticket counts — and assembles. `volunteering-spec.md` already anticipates exactly this:
  "`getVolunteerTotals` is the query it will call; no work needed here." A cross-module rollup that
  wrote its own queries would duplicate every module's definition of its own numbers and drift from
  them silently.

- **No materialized rollup tables and no nightly aggregation cron.** Every aggregate in the repo
  runs over hundreds to low thousands of rows. `community-stats.ts` demonstrates the escape hatch
  when one genuinely gets hot — a 24-hour KV cache with a staff-triggered bust — and the
  volunteering spec documents the counter-case: "a report that goes stale immediately after an
  approval is worse than a report that takes an extra 30ms." Cache per report, when measured, not
  by default.

- **Charts are an open question for the annual-report phase, not a settled no.**
  `volunteering-spec.md` says "Tables, not charts. There is no charting dependency in the app and
  this does not justify adding one." That is a marginal-cost call about one page — one consumer
  does not justify a dependency — and charts do not appear in that spec's Deferred list at all.
  The annual report changes the premise, and the same spec says why two lines earlier: "**By
  month** — a trend table; grant applications ask for one." Decide it then, on two questions:
  whether a trend line makes a funder-facing number more defensible or merely more interpretable,
  and — if a chart is taken — that the packet is a print artifact, so server-side SVG rendering is
  the deciding constraint on which library.

## Surveys are out of scope

Reporting presents data that already exists. Surveys create it. This spec owns the first only.

What exists today is not a survey tool. `volunteer_shift_feedback` is a single-purpose table: one
row per `signupId` (unique FK, cascading), a 1–5 `rating`, a `wasSetUp` boolean, an optional
`comment`. Two hardcoded questions. A general survey feature needs question types, delivery and
scheduling, response windows, reminder crons, one-response-per-subject enforcement and explicit
anonymity guarantees — the volunteer case got every one of those hardcoded for its single shape.
That is its own spec.

If one is ever written, the build-vs-buy question resolves under this spec's rule:

- **Responses must attach to member identity → ours.** The volunteer survey qualifies. It is gated
  to the person who actually worked the shift, allows one response per signup, and feeds a report.
  Its anonymity is a **presentation** choice rather than a collection limitation —
  `summarizeFeedbackByRole` is commented "Deliberately anonymous — no member names… attaching names
  would just teach volunteers to answer politely." A hosted form cannot verify who worked
  Saturday's shift, so it cannot produce this at all.
- **Genuinely anonymous and one-off → use a hosted form.** No identity join means no reason to
  build, and `conventions.md#dependency-posture` prefers the managed service.

What this spec does own is that **survey results report like any other module aggregate**: a
module-owned service, then that module's report page, then the annual rollup if it is a headline
number. `volunteer-feedback-service.ts` is the precedent, and a board packet plausibly wants the
volunteer satisfaction average it already computes.

## Prerequisite: nothing in the app sums cash

Credits are aggregated — `credit-service.ts` runs `coalesce(-sum(creditTransaction.amount), 0)`
for hours used. But there is no `sum()` over `paymentCache.amountCents` anywhere;
`payment-cache-service.ts` computes a pagination count and nothing else. So the annual report's
volunteer-hours and credits lines have services behind them already, and its **revenue line is a
design decision rather than a query to write**.

The proposal, following the discipline `production-workflow-spec.md` settled on:

1. **Stripe is the authoritative total.** The Reporting API (`reporting.report_run`) produces the
   same CSVs as the dashboard's balance and payout-reconciliation reports, programmatically.
2. **`sum(payment_cache.amount_cents)` grouped by member or reservation** supplies the breakdown
   Stripe cannot produce, because Stripe does not know what a reservation is.
3. **The two are cross-checked**, and a disagreement is surfaced rather than silently preferred.
   A revenue figure that quietly under-reports is worse than one that refuses to render.

Note the boundary this preserves: Stripe is the single view of **revenue**, not of net income.
Cash the Collective takes in and hands straight back out — the band cut at the door — is not
revenue it kept, which is why `production-workflow-spec.md` rejected reporting the door take to
Stripe at all.

## Phasing

Each is its own PR.

1. ✅ **The kit** — `range.ts`, `bucket.ts`, `csv.ts`; `volunteer-report-service.ts` refactored onto
   it. Shipped with the valued volunteer hour, which needed the range helpers anyway.
   `range.spec.ts` pins both club-time boundaries as instants: a naive `new Date('2026-07-01')` is
   the previous evening here, and an upper bound spelled as a date drops the final day's work.
2. **`DateRangeFilter.svelte`** — bits-ui, wired into the volunteer report in place of its
   hand-rolled inputs. Still open; the report keeps its own date inputs for now.
3. ✅ **First CSV** — `/staff/volunteer/report/export`, closing the volunteering spec's deferred
   item. A `+server.ts` rather than a remote function, because a download needs
   `Content-Disposition` — so `requireStaff()` is the first statement rather than the
   remote-function boundary doing it. Two decisions worth carrying to the next export: an unpriced
   figure exports **blank, not zero**, and there is **no footer total** where two columns overlap.
4. **The annual rollup** — `annual-report-service.ts` and `/staff/reports`, including the revenue
   decision above. Charts decided here or not at all. `getContributedValue` is the query its
   volunteer-value line will call; no work needed there.

## Deferred

- **Product usage analytics.** Cloudflare Web Analytics is the recommended starting point and
  needs no code; see `conventions.md#dependency-posture`. Analytics Engine stays unbound until a
  concrete question needs it.
- **Campaign analytics.** `email-marketing-spec.md` defers a dashboard and records that "V1 uses
  aggregate stats from Postmark's API" — but nothing reads Postmark's Stats API today and
  `campaign` stores only `recipientCount`. Open/click rates by tag need no new tables.
- **PDF output.** A print stylesheet over the annual-report page first. If a real PDF is ever
  needed, Cloudflare Browser Rendering is the platform answer.
- **Bulk table actions and per-report sorting.** Both wait for a report that genuinely needs them,
  and both are per-page decisions under the rules above.

## Related

- `docs/development/conventions.md#dependency-posture` — which analytics and reporting tools we use
  and why, including what Cloudflare, Stripe and Postmark each own.
- `docs/specs/shipped/finance-spec.md` — Stripe as the payment ledger.
- `docs/specs/production-workflow-spec.md` — settlement, and why the door take never reaches Stripe.
- `docs/specs/shipped/volunteering-spec.md` — the reference report and its deferred CSV export.
