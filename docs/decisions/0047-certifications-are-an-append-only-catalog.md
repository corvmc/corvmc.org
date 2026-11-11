# 0047 Certifications are an append-only catalog

- **Date:** 2026-08-08
- **Status:** Accepted
- **Issue:** [#235](https://github.com/corvmc/corvmc.org/issues/235)

## Context

Some volunteer work needs clearance first. Two kinds of clearance share the name: internal ones
the collective grants (cleared on the sound desk), and external cards a member brings (First Aid,
Food Handler), which carry a number and lapse. One clearance often covers several roles. After an
incident the question asked is whether a member's card was current on the day they worked.

## Decision

1. **A certification is its own catalog**, `volunteer_certification`. Roles reference it through
   `volunteer_role_certification`.
2. **Held certifications append.** A renewal is a new `member_certification` row, and there is no
   unique constraint on member and certification.
3. **Expiry is a date, never a status.** Current, expiring, expired and revoked are derived from
   `expires_at` and `revoked_at` against a date in club time.
4. **`expires_at` is stamped at grant** from the catalog's `validity_months`, so editing the
   catalog does not expire cards already issued.
5. **Cleared on a date** is `granted_at <= d`, `expires_at >= d` and `revoked_at > d`. A card is
   valid through its expiry date. A clearance pulled on the day was not in force that day.
6. **A clearance that was ever true is revoked, with a required reason.** A hard delete is only for
   a record the same staffer created the same day.
7. **Certifications gate a member's own claim on a shift**, as of the shift's date. They never
   refuse a log of work already done; the log goes to review instead.

## Alternatives rejected

- **A `requires_training` flag on each role.** It has nowhere to put First Aid, and training that
  clears two roles would be recorded twice.
- **Overwriting the grant on renewal.** It erases the answer to whether a card was current on a
  past date.
- **A stored status column.** It is wrong when the clock passes midnight, and keeping it right
  needs a cron.
- **Deleting a pulled clearance.** It erases the window the clearance covered.

## Consequences

- "Does this member hold X now" reads the newest row by `granted_at`.
- Every eligibility check takes a date, and shift checks pass the shift's date.
