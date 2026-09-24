# Development: sponsors and grants, as two modules

Tracking: #574 (Sponsor Management) and #595 (Grant & Fundraising Tracker). Decision: #1479.

**Amended 2026-09-23.** This spec first described one `agreement` ledger shared by grants and
sponsorships (#1458, built as #1457). The owner reversed that in #1479: sponsors and grants are
separate modules, each with its own tables, service and pages. #1457 was closed unmerged. What the
two modules still share is one small helper, `src/lib/utils/deadline.ts`.

## Purpose

`committees-and-roles-spec.md` gives the Development committee this story: "track grant
applications and their reporting deadlines, and maintain business sponsorships". It marks both
halves 🆕. Before this, nothing in the app recorded either one.

## Why two modules

The two differ where it matters for the record:

- **A sponsor is a relationship that renews.** The same business sponsors season after season, so
  the business is a row (`sponsor`) and each term of support is a child row (`sponsorship`). The
  question staff ask is "whose term ends next".
- **A grant is an application with obligations after the award.** A funder can be applied to many
  times; each application has a requested and an awarded amount, and an award usually owes more
  than one report (interim and final). The question is "what is due next: an application, a
  report, or the end of the award period".

## Sponsor module

**Tables.**

| `sponsor`                  | Notes     |
| -------------------------- | --------- |
| `name`                     | Required  |
| `website`                  | Nullable  |
| `contactName/contactEmail` | Nullable  |
| `notes`                    | Free text |
| `deletedAt`                | Archived  |

| `sponsorship`         | Notes                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `sponsorId`           | FK `sponsor`, `on delete restrict`                                 |
| `title`               | "2027 season". Required                                            |
| `tier`                | Free text ("Gold", "In kind"). Nullable                            |
| `status`              | `prospect` (pitched) → `active` → `ended`; `declined` from pitched |
| `amountCents`         | What was agreed. Nullable                                          |
| `startsOn` / `endsOn` | `YYYY-MM-DD`. The term                                             |
| `notes`               | Free text                                                          |

**Deadline.** An `active` sponsorship's `endsOn`, overdue once passed until someone marks it
ended or adds the renewal. Nothing else has one.

**Pages.** `/staff/sponsors`: every sponsor with its current sponsorship (a running term beats a
pitch), soonest-ending first, idle sponsors last. `/staff/sponsors/[id]`: contact facts, a lapsed
term called out, and the sponsorship history with add, edit and delete in modals. A sponsor with
sponsorships is archived rather than deleted (#1577): it drops off the list, keeps every
sponsorship and credit, shows again under "Show archived", and can be restored. Delete is only for
a sponsor with none.

**Capability.** `sponsor: ['read', 'manage']`.

## Grant module

**Tables.**

| `funder`                   | Notes               |
| -------------------------- | ------------------- |
| `name`                     | Required            |
| `website`                  | Nullable            |
| `contactName/contactEmail` | The program officer |
| `notes`                    | Free text           |
| `deletedAt`                | Archived            |

| `grant_application`    | Notes                                                     |
| ---------------------- | --------------------------------------------------------- |
| `funderId`             | FK `funder`, `on delete restrict`                         |
| `title`                | "2027 operating support". Required                        |
| `status`               | `prospect` → `applied` → `awarded` → `closed`; `declined` |
| `amountRequestedCents` | Nullable                                                  |
| `amountAwardedCents`   | Nullable; funders routinely award less than was asked     |
| `applyBy`              | `YYYY-MM-DD`. The application deadline                    |
| `startsOn` / `endsOn`  | `YYYY-MM-DD`. The award period                            |
| `notes`                | Free text                                                 |

| `grant_report`       | Notes                                       |
| -------------------- | ------------------------------------------- |
| `grantApplicationId` | FK `grant_application`, `on delete cascade` |
| `title`              | "Interim report". Required                  |
| `dueOn`              | `YYYY-MM-DD`. Required                      |
| `submittedOn`        | `YYYY-MM-DD`. Outstanding while null        |
| `notes`              | Free text                                   |

**Deadline.** Pure, from the application, its reports and today:

- `prospect`: `applyBy` ("Apply by").
- `applied`: none; the list shows "Awaiting decision".
- `awarded`: the earliest of every unsubmitted report ("Report due") and `endsOn` ("Award ends").
- `closed`: the earliest unsubmitted report, if any. A final report usually falls due after the
  money is spent, so closing an award does not hide one that is still owed.
- `declined`: none.

**Pages.** `/staff/grants`: open applications (plus any closed one still owing a report), sorted by
deadline with undated rows last; "Show closed" adds the rest. `/staff/grants/[id]`: the application
as a `DefinitionList`, an overdue Alert, and its reports with add, edit (marking submitted) and
delete. `/staff/grants/funders`: funders with create, edit, archive and restore, and, while
unused, delete. An archived funder is off the list (until "Show archived") and off the picker for
new applications, but stays pickable on an application that already names it (#1577).

**Capability.** `grant: ['read', 'manage']`.

## Shared

- Dates are ISO day strings, not timestamps. A deadline is a calendar day in Corvallis with no time
  of day, so a string sorts correctly and cannot drift across a timezone boundary. Today is
  `clubToday()`.
- `src/lib/utils/deadline.ts` holds `due`, `earliest`, `byDeadline` and `formatIsoDay`. Nothing
  else is shared: no counterparty table spans both modules.
- Status moves through each edit form's select, not a state machine. No transition has a side
  effect.
- `staff` holds `manage` on both through the derived matrix. The treasurer gets `read` on both,
  since both are money coming in. No position gets `manage`: Development is a committee.
- Both sit under Money in the staff nav, as "Sponsors" and "Grants".
- No amount here is accounting. An award arrives by cheque and is a manual `grant` ledger entry;
  the amount columns are declared `notAccounting` in `money-map.ts`.

## Not in this slice

Each of these is tracked on its own:

- Sponsor logos and per-event placement on the event page and in event blasts: #583 and #1476,
  built on `feature/sponsored-event-placement`. The poster logo still needs #606.
- Deadline reminders through the reminder sweep registry (#1186), plus a staff dashboard panel:
  #1477.
- Permits, licenses and insurance renewals: #1478. #1597 decided they become a small module of
  their own, not a kind of recurring work order.
- Taking money. Anything that moves money waits for the payment seam (#522).
