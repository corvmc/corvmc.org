# NNNN Form 8282 is the only inventory tax check

- **Date:** 2026-08-27
- **Status:** Accepted
- **Issue:** PR [#302](https://github.com/corvmc/corvmc.org/pull/302)

## Context

Three nonprofit reporting rules touch donated goods:

- **Form 8282.** Disposing of "charitable deduction property" within three years of receipt obliges
  a filing within 125 days, with a copy to the donor. That property is defined as property the
  organisation signed a Form 8283 for, which a donor seeks only above $5,000.
- **FASB ASU 2020-07.** Gifts-in-kind appear as a separate line in GAAP financial statements. It
  binds the statements, not the organisation, and CMC has never been asked for a GAAP statement.
- **Form 990 Schedule M.** Required at $25,000 of noncash contributions in a year, or for any gift of
  art or historical treasures.

## Decision

The app builds only the Form 8282 warning.

1. **A signed Form 8283 arms it.** Only donated, disposed units whose acquisition has
   `acknowledgedAt` become obligations. The rest are a count, `noFormOnRecord`.
2. **It flags; a person decides.** Resolving takes free text, so "no filing was due" and "filed on
   the 2nd" are both recordable.
3. **The rule is a pure function** in `form-8282.ts` with `now` injected. Its window counts calendar
   years, so a leap day cannot move it.
4. **The ASU 2020-07 disclosure fields are captured but have no screen.** `inKindContributions()`
   exists for the day a funder asks.
5. **Schedule M is not built.**

## Alternatives rejected

- **Flag every donated disposal.** CMC has never signed a Form 8283, so every flag would be false,
  and staff would learn to dismiss the warning.
- **Build the in-kind disclosure screen now.** It answers a requirement CMC does not have.
- **Build Schedule M now.** Noncash gifts are far below the trigger.

## Consequences

- The disclosure fields (`fairValueCents`, `fairValueBasis`, `monetized`, `intendedUse`) are
  editable on the acquisition page, because they cannot be reconstructed later.
- The model holds goods only. It matches the 990's noncash scope, which excludes donated services
  and use of space; GAAP counts both.
- The unbuilt screen and Schedule M are proposed on [#2554](https://github.com/corvmc/corvmc.org/issues/2554).
