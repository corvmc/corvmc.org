# Credit comp ceiling — staff comp a little, admins handle the rest

Tracking: #579.

## Purpose

Adding practice-room credit is an all-or-nothing capability. `credit.adjust` is admin-only
(`adminOnlyCapabilities` in `src/lib/config.ts`, shipped in #489). So when a practice session is
interrupted and the member should get the hour back, the front desk has to ask one of the two
admins. Usually the comp just doesn't happen. `admin-vs-staff-spec.md` (open question 2) left
the fix to this issue: bound the authority by an amount rather than by role.

## What gets built

**One new capability, `credit.comp`.** It sits under the `credit` resource. It is not in
`adminOnlyCapabilities`, so `staff` holds it through the derived matrix, and so does `admin`,
who holds everything. No named position gets it: comping is front-desk work, and no position
is the front desk yet.

**One ceiling, in config, per credit type.**

```ts
export const creditCompCeiling: Record<CreditType, number> = {
	free_hours: 4, // credits (30-minute blocks), so 2 hours
	equipment_credits: 0 // not compable; an admin adjusts these
};
```

The ceiling lives in `config.ts`, beside `creditTypeConfig`. Moving it is a one-line diff, the
same property that made #489's conservative choice cheap.

**`adjustCredits` authorises by amount.** The remote form stays the same, and so does its Zod
schema.

- A caller holding `credit.adjust` works exactly as today: any amount, either sign.
- A caller holding only `credit.comp` may **add** up to the ceiling for that credit type in one
  adjustment. A deduction, an amount above the ceiling, or a type whose ceiling is 0 comes back
  as a field issue on `amount`. The message states the ceiling in hours and says an admin can
  do more. It is not a 403: the staffer can see the problem and fix it, which is the rule the
  remote already follows.
- A caller holding neither gets a 403, as today.

**The ledger says which it was.** A comp is written with a new `staff_comp` transaction source,
labelled "Staff comp", so the ledger shows it apart from `admin_adjustment`. `source` is a
TS-level text enum, so no migration is needed.

**The modal says what the staffer can do.** `MoneyPanel` reads capabilities from
`getStaffLayout()`:

- The Adjust action appears only to a holder of `credit.adjust` or `credit.comp`. A treasurer
  holds `credit.read` alone, so the button no longer appears only to fail on submit.
- A comp-only holder sees helper text under Amount: "Up to 2 hrs of free hours. An admin can
  add more."

## Deliberately bounded

- **The ceiling is per adjustment, not per period.** Every comp is in the ledger under its own
  source, with the staffer's reason, and the ledger is what a treasurer already reads. Add a
  rolling cap if the ledger ever shows abuse.
- **Committee spending limits**, the other half of #579, are filed separately. Committees have
  no spend surface to bound yet.
