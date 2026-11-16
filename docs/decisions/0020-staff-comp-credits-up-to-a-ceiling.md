# 0020 Staff comp credits up to a ceiling

- **Date:** 2026-09-23
- **Status:** Accepted
- **Issue:** [#579](https://github.com/corvmc/corvmc.org/issues/579)

## Context

Adding practice-room credit was admin-only (`credit.adjust`, #489). When a session was
interrupted and the member should get the hour back, the front desk had to ask one of two
admins, and the comp usually did not happen.

## Decision

Bound the authority by amount rather than by role.

1. A new capability, `credit.comp`, held by staff and admin. No named position holds it.
2. `creditCompCeiling` in `config.ts` sets the most one comp may add, per credit type: 4
   free-hour credits (2 hours), and 0 equipment credits.
3. `adjustCredits` checks `credit.adjust` first, which allows any amount either way. A holder
   of `credit.comp` alone may only add, up to the ceiling. Anything else is a field issue on
   the amount that names the ceiling, not a 403.
4. A comp is written with source `staff_comp`, apart from `admin_adjustment`.

## Alternatives rejected

- **Give staff `credit.adjust`.** Deductions and unbounded additions stay an admin act.
- **A per-period cap.** Every comp is in the ledger with its source and reason, which a
  treasurer already reads. A rolling cap can follow if the ledger shows abuse.

## Consequences

- Moving the ceiling is a one-line config change.
- Committee spending limits, the other half of #579, are separate work.
