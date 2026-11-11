# NNNN Serialization is not a capitalization threshold

- **Date:** 2026-08-27
- **Status:** Accepted
- **Issue:** PR [#302](https://github.com/corvmc/corvmc.org/pull/302)

## Context

An early inventory design carried `CAPITALIZATION_THRESHOLD_CENTS = 100_000` in config and an
`isCapitalized()` check in receiving. That value decided whether an arrival became a tracked
`inventory_asset` or bulk stock. No rule sets a capitalization threshold; an organisation adopts one
by board policy, and CMC has not adopted one.

## Decision

There is no capitalization threshold in the app. Whether an item is `serialized` or `bulk` is an
operational choice the operator makes per item when creating it. Price plays no part.

## Alternatives rejected

- **Keep the constant and route receiving through it.** The number implied a $1,000 policy that
  does not exist, and could later be cited as that policy.
- **Use any monetary threshold to decide serialization.** Value and tracking do not correlate. A
  $200 microphone has a serial, goes out on loan and comes back damaged, so it needs its own row. A
  $1,500 cable order is not one asset.

## Consequences

- If CMC adopts a policy, the number belongs in the accounting records. The app's role would be a
  notice to the treasurer when an arrival is above it, never a control that routes anything.
- For reference: federal awards cap equipment capitalization at the lower of the organisation's
  policy or $10,000 (2 CFR 200, 2024 revision).
