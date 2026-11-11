# 0040 Reports are module-owned over a shared kit

- **Date:** 2026-08-27
- **Status:** Accepted

## Context

The app had one report, the volunteer hours report, and it alone knew how to filter a range in
the collective's time zone, bucket rows by month or compute a share of a total. An annual report
for the board and funders, CSV export for the volunteer report, settlement and campaign figures
were all waiting on it. Whatever shape the second report took would be copied a dozen times.

## Decision

1. **A report belongs in the app only when it joins data no single vendor holds.** If Stripe or
   Postmark holds all of it, their reporting answers it. A question asked once is answered from a
   `wrangler d1 export`, not a page.
2. **Each module owns its report service.** What is shared is a small kit in
   `src/lib/server/report/`: `range.ts`, `bucket.ts`, `csv.ts`, and `DateRangeFilter.svelte`.
3. **The annual report writes no queries of its own.** `annual-report-service.ts` calls each
   module's report service and assembles the result.
4. **CSV goes through `csv-stringify` with `escape_formulas` forced on.** Exports carry
   member-written text, staff open them in Excel, and a cell beginning `=`, `+`, `-` or `@` runs
   as a formula.
5. **Sorting a report is a server-side parameter on that page**, because report tables are
   paginated on the server.
6. **No rollup tables and no nightly aggregation.** A report that is measured to be slow gets its
   own cache.
7. **The annual report has no charts.** Each section is a few lines that a table states exactly,
   and a single year is not a series.

## Alternatives rejected

- **A central reporting system**: a registry, a query builder, saved reports or a `report`
  table. Each had no second consumer.
- **A hand-written `toCsv`.** It would quote correctly and leave formula injection open.
- **A client-side table library for sorting.** It would sort the 50 rows on screen, not the
  result set.
- **A date-range picker from bits-ui.** Native date inputs match every other filter bar, work
  without JavaScript and use the platform picker. The shared component adds presets: This year,
  Last year, All time.
- **Revenue cross-checked against Stripe's Reporting API.** Superseded once `financial_entry`
  held the ledger reconciled to Stripe (#825). The annual report reads the ledger and states
  where its coverage begins.

## Consequences

- A number on the annual report and the same number on its module page come from one function.
- A new report adds a service to its own module and reuses the kit.
- A CSV download is a `+server.ts` route, so its capability check is the handler's first
  statement rather than a remote function's.
- An unpriced figure exports blank, not zero.
