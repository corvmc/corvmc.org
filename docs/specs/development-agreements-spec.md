# Development agreements — grants and sponsorships, and when they come due

Tracking: #595 (Grant & Fundraising Tracker) and #574 (Sponsor Management), built together as one
mechanism.

## Purpose

`committees-and-roles-spec.md` gives the Development committee this story: "track grant
applications and their reporting deadlines, and maintain business sponsorships". It marks both
halves 🆕. Nothing in the app records either one: `git grep -i sponsor` over `src/` finds
nothing, and no table holds a grant.

The two issues describe the same thing. Each is an **agreement with a counterparty**, with dates
that come due (apply by, report by, renew by) and something owed afterwards. Sponsor placement
(#583, closed by #1411 "until #574 has a real agreement") also needs a sponsorship row to hang on,
and nothing can be placed until one exists.

## What gets built

**One table, `agreement`**, staff-only.

| Column                     | Notes                                                                  |
| -------------------------- | ---------------------------------------------------------------------- |
| `kind`                     | `grant` \| `sponsorship`                                               |
| `counterparty`             | Free text: "Oregon Arts Commission", "Troubadour Music". Required      |
| `title`                    | "2027 operating support", "Season sponsor". Required                   |
| `status`                   | `prospect` → `applied` → `active` → `ended`; `declined` from `applied` |
| `amountCents`              | Asked while prospect or applied, awarded once active. Nullable         |
| `tier`                     | Sponsorship tier as free text ("Gold"). Nullable                       |
| `contactName/contactEmail` | The program officer or the sponsor's contact. Nullable                 |
| `applyBy`                  | `YYYY-MM-DD`. The application deadline                                 |
| `startsOn` / `endsOn`      | `YYYY-MM-DD`. The award period or sponsorship term                     |
| `reportDueOn`              | `YYYY-MM-DD`. The reporting obligation                                 |
| `notes`                    | Free text                                                              |

The dates are ISO date strings, not timestamps. A deadline is a calendar day in Corvallis with no
time of day, so a string sorts correctly and cannot drift across a timezone boundary. Today's date
comes from `formatDateInTz(now, DEFAULT_TIMEZONE)`.

Status moves through the edit form's select, not a state machine. No transition has a side
effect, and the order above is advice, not a guard.

**One derived value, the next deadline.** It is a pure function of the row and today's date:

- `prospect`: `applyBy`, labelled "Apply by".
- `applied`: no deadline; the list shows "Awaiting decision".
- `active`: the earlier of `reportDueOn` ("Report due") and `endsOn` ("Ends"). A report date that
  has passed stays the deadline and reads as overdue until someone moves the status on.
- `declined`, `ended`: none.

**One capability resource, `agreement: ['read', 'manage']`.** `staff` holds both through the
derived matrix. The treasurer gets `read`, since an award is money coming in. No position gets
`manage`, because Development is a committee, not a position.

**Two pages under Money**, in the staff nav as "Grants & sponsors":

- `/staff/agreements`: a table of open agreements (prospect, applied, active), sorted by next
  deadline with undated rows last. A "Show closed" toggle adds declined and ended rows. Create
  opens in a modal on this page.
- `/staff/agreements/[id]`: the record as a `DefinitionList`, with Edit (modal) and Delete.

**Seed:** five agreements covering every status and both kinds, including one report that is
overdue.

## Not in this slice

Each is filed as a sub-issue of #574 or #595:

- Sponsor logos and placement preferences (poster, event blast, event page). The poster needs #606.
- Deadline reminders through the reminder sweep registry (#1186), plus a panel on the staff
  dashboard.
- Permits, licenses and insurance renewals as a third `kind`. Same shape; nobody has asked.

What is not planned at all: taking money here. An award arrives by cheque or transfer and a
sponsorship by invoice, and anything that moves money waits for the payment seam (#522).
