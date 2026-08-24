# Standardization rollout — progress checklist

Tracks execution of [standardization-audit.md](../reports/standardization-audit.md).
Survives between sessions. Update the status column as tranches land.

**Decision made 2026-08-16:** timezone converges on **`DEFAULT_TIMEZONE` (venue time)**.
This is a location-based application — a 7pm booking is 7pm at the venue regardless of
where the member is standing. `DateTimeRange`/`Duration` are therefore unblocked.

## Status

**Re-prioritised 2026-08-16** after re-verifying the audit's three "correctness issues" — all
three were overstated (see the revision note in the audit). Timezone convergence moves to #1
because it is the only genuinely user-visible defect of the four.

| #   | Tranche                                                                          | Status | Commit  |
| --- | -------------------------------------------------------------------------------- | ------ | ------- |
| 1   | **C4** Timezone → `DEFAULT_TIMEZONE` everywhere; then `DateTimeRange`/`Duration` | ✅     | cdb94b2 |
| 2   | `DefinitionList` — 11 byte-identical copies / 9 files                            | ✅     | (next)  |
| 3   | `Money` + route 3 fee formulas through `$lib/finance/fees` (C3, drift risk)      | ⬜     |         |
| 4   | **C2** `mapDomainError` in remaining 22 files; 11 fall-through classes           | ⬜     |         |
| 5   | Filter schemas — `page` converge dropped (not a bug); `status` gap still open    | ⏸️     |         |
| 6   | Centralize validation limits — named kinds on unambiguous fields                 | ✅     | (next)  |
| 7   | Enum/label single source — **withdrawn, finding was wrong**; rule documented     | ❌     | (next)  |
| 8   | Dead helpers resolved; `requireStaffOrOwner` adopted at 3 sites                  | ✅     | (next)  |
| 9   | `ShareButton`, `initials`→`format.ts`, `StatCard` size prop                      | ✅     | (next)  |
| 10  | Pattern-drift sweep — alerts done; rest needs per-item judgement, see note       | 🔵     | (next)  |
| 11  | `RecordHero` / `PersonChip` — need design calls                                  | ⬜     |         |

Legend: ⬜ not started · 🔵 in progress · ✅ done · ⏸️ parked · ❌ withdrawn (finding didn't hold)

## Ground rules

- One tranche per commit. No co-author lines.
- Regression test **before** the fix for anything behavioural (C1, C2, C3, timezone).
- Run the minimum tests needed while working; full suite before each commit.
- Clean baseline is ~23 failed _files_ / **0 failed tests** — failures in that shape are
  pre-existing module-resolution noise, not regressions.

## Notes / decisions log

- (2026-08-16) Timezone: venue time (`DEFAULT_TIMEZONE`) everywhere. See above.
- (2026-08-16) Audit C1/C2/C3 all overstated on first pass; corrected in place before any code
  changed. C1 is not a bug (callers coerce); C2 is 11 classes not ~32; C3 is drift risk only.
  Lesson: verify a finding immediately before acting on it, not just when writing it down.
- (2026-08-16) Two dead helpers found: `parsePagination()` (`paginate.ts:14`) and
  `requireStaffOrOwner()` (`authorization.ts:146`) — both zero call sites. Decide adopt-or-delete.
- Clean server-project baseline confirmed 2026-08-16: **154 files / 1903 tests / 0 failures**.
- (2026-08-16) Tranche 1 landed. Note for anyone extending `format.ts`: format the instant
  _directly_ in the named zone. Converting to a local `Date` first and formatting that shifts the
  hour whenever the venue wall-clock falls in the viewer's DST gap — silently, with no error.
- (2026-08-16) `format.spec.ts` forces `TZ=UTC` and asserts the ambient zone differs from the
  venue. Do not remove that guard: this repo's primary dev machine is set to
  `America/Los_Angeles`, so without it every assertion passes for the wrong reason.
- (2026-08-16) `DateTimeRange`/`Duration` are still unbuilt — the timezone blocker is cleared,
  but the 5 competing duration labels still need one canonical shape chosen.
- (2026-08-16) Tranche 2 landed. `member/equipment/loans/+page.svelte` deliberately NOT migrated:
  its `<dt>`s hold icons + tooltips + responsive spans, which `Fact`'s string `label` doesn't take.
  Adding a snippet-label escape hatch for one consumer would over-fit the component.
- (2026-08-16) Watch for `class:` directives when converting an element to a component — they do
  not forward to the inner element. Two silent styling regressions were caught this way
  (`staff/equipment/[id]`, `staff/equipment/loans/[id]`); both became `class={cond ? 'x' : ''}`.
- (2026-08-16) Tranche 3 landed **without** the `<Money>` component the audit proposed. The call
  sites render as `${cents(x)}` inside spans mixed with other text; a component would have added
  ceremony without removing anything. Consolidating on the existing `formatCents`/`formatDollars`
  deleted every duplicate on its own. Revisit only if a real need for `perUnit`/`zeroLabel` appears.
- (2026-08-16) C2 corrected a second time. 10 of the 11 "fall-through" classes are handled inline
  in remote catch blocks; only `UserHasPublishedListingsError` actually 500'd. Fixed + tested.
  **Pattern to note: every severity claim in the original audit was inflated because it inferred
  behaviour from structure instead of tracing call paths.** Trace before believing the next one.
- Remaining in tranche 4: migrate the 22 remote files onto `mapDomainError` so a new error class
  no longer has to be remembered in a hand-written ladder. That is the mechanism that hid this bug.

## Open decisions

- ~~**`InsufficientCreditsError`: 409 or 422?**~~ **Resolved 2026-08-17: neither.** The class was
  doing two unrelated jobs. Every credit-spending service clamps to the balance before deducting,
  so for them it only ever means "someone spent between my read and my write" — a race to retry,
  which `loan-service.ts:70` already treats that way. The one path a human can trigger is the staff
  adjustment form, where it is a field mistake, not a status. `adjustCredits` now answers with an
  issue on `amount` (the `SlugUnavailableError` precedent), and the class is out of the mapper.
- **Two dead helpers, adopt or delete:** `parsePagination()` (`db/paginate.ts:14`) and
  `requireStaffOrOwner()` (`authorization.ts:146`), both zero call sites. `requireStaffOrOwner`
  duplicates a check four places hand-roll, so adopting it is probably right.

## Notes / decisions log (cont.)

- (2026-08-16) Tranche 5: migrating 10 error classes onto `DomainError` created a **circular
  import** — `errors.ts` imports every service to build its ladder, and the services now import
  the base back. `extends` runs at module-init, so 16 test files died with
  `Class extends value undefined`. **`svelte-check` passed throughout**: it is an evaluation-order
  fault, not a type fault. Fixed by moving the base into the dependency-free leaf module
  `src/lib/server/domain-error.ts`. **Keep that file importing nothing.**
- (2026-08-16) `band-address.remote.ts` deliberately keeps its inline handling: `SlugUnavailableError`
  resolves to `invalid(issue.newSlug(...))`, a form-field issue, not an HTTP error. `mapDomainError`
  cannot express that, and a blanket migration would have broken that form's validation UX.
- (2026-08-16) When a mock stands in for a class whose _behaviour_ depends on a base (here
  `httpStatus`), the mock has to extend the real base. `users.remote.spec.ts` used bare
  `extends Error` stand-ins, which silently stopped exercising the mapping once it went generic.
- (2026-08-16) Tranche 7 **withdrawn**. Every sub-finding failed verification: the enum split has
  a real rule (client-reachability — `$lib/server` can't be imported from the browser), the two
  `entityLabels` maps differ in label density on purpose, `CustomDomainSection`'s "Waiting on DNS"
  is domain vocabulary the generic registry can't express, and extracting `StatusBadge`'s maps has
  no consumer but its own spec. The rule is written down in `conventions.md` instead.
- (2026-08-16) Tranche 6 scoped deliberately: named constants applied only where the _field name_
  makes the kind unambiguous. Numbers that merely coincide keep their literal — a shared constant
  asserts two fields must change together, and that is false for e.g. a flag reason at 255.
- (2026-08-16) `parsePagination()` deleted rather than adopted. Nothing used it, the app drives
  pagination from `$state` not the URL, and it is the one helper that _would_ have made the C1
  `?page=` divergence a real bug — leaving it in place kept that trap loaded.
- (2026-08-16) Adopting `requireStaffOrOwner` changed a call _count_: the helper short-circuits on
  ownership without consulting `isStaff`, so a spec's `mockResolvedValueOnce(false)` stopped being
  consumed and leaked into the next test. Fixture hardened. Watch for this whenever a refactor
  removes a call a one-shot mock was feeding.
- (2026-08-16) Tranche 9 landed. All three items were verified as real duplication first (the
  share handlers and `initials` bodies are byte-identical; `StatCard` genuinely lacked the prop
  its bypassers needed). `RowCard` deferred — its ~10 sites differ in padding, shadow, and whether
  the wrapper is an `<a>`, so it needs a design call rather than a mechanical extraction.
- (2026-08-16) The shared `initials()` adds a `.filter(Boolean)` the two copies lacked: a trailing
  or doubled space made `p[0]` undefined and rendered "UNDEFINED". Covered by a test.
- (2026-08-16) **Tranche 10 should not be run as a bulk sweep.** Its Tier-2 counts are structural
  greps that cannot tell a deliberate choice from drift, and spot-checking kept finding the former:
  - The three "redundant full-page spinners" are scoped `{#await}` blocks that keep the page header
    and filters visible while one section loads. Deferring to the panel boundary would hide them —
    the current code is _better_ than what the audit proposed.
  - `Alert` wraps its children in a `<p>`, so it only fits single-paragraph messages. One
    conversion had to be reverted (`staff/events/[id]`, a warning containing a checkbox and a
    grid), and five needed their redundant inner `<p>` unwrapped to avoid `<p>` inside `<p>`.
    Convert per file, look at the body first, and expect roughly one in six to be a legitimate
    exception.
- **Pre-existing bug, not introduced here:** four `<Alert>` usages nest block content inside its
  `<p>` — `member/events/[id]/manage` (3) and `staff/settings:924` (which puts a `<ul>` inside).
  The parser breaks those out, so they render outside the alert box. Worth a separate fix.
- (2026-08-17) Fixing the server half alone would have been invisible: the Adjust Credits modal
  used raw `<input {...fields.amount.as('text')}>` inside a hand-rolled label, so a field issue set
  `aria-invalid` and rendered **no message at all**. Converted to `FormField` in custom-input mode
  — inputs keep their own `.as()` spreads so the submission is unchanged, the wrapper supplies the
  error slot. **Check the markup renders the issue before assuming an `invalid()` fix is done.**
- (2026-08-17) Ticket checkout's lost-credit race no longer escapes as an unhandled throw. Note
  the general rule this and `adjustCredits` both turned on: **`Form` routes a thrown error into
  `onfailure(issues)` with no message**, so `throw error(4xx, 'helpful text')` from a `form()`
  reaches the user as a generic toast. If a message needs to be read, it has to be an issue.
- (2026-08-17) Test-authoring caution: a `expectRejects(..., 'field')` assertion passes for _any_
  validation rejection, including ones firing long before the code under test. The ticket-race test
  bailed at a "Tickets not available" guard and looked green until probed. It now asserts
  `checkout` was actually reached, and was mutation-checked against the fix being removed.
