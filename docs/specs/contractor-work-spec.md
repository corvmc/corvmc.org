# Contractor work

**Status:** 🔧 In progress — schema, services and seed shipped; staff surfaces to follow.

A damaged asset gets repaired in one of two places, and until now the app modelled neither. The
**work order** (`docs/specs/` — the `work_order` extension) covers the first: work somebody at
CMC does, claimed by a member and paid in volunteer hours. This covers the other — work done by
somebody you pay — and the building service that has never had anywhere to live at all.

Two gaps close, both named in `committees-and-roles-spec.md`:

> **As Facility**, I want repairs and maintenance tracked from report to resolution […] Outside
> contractors are the same gap seen from the other side: nothing records who services the building
> or when they were last in. (:514)

> **As Development**, I want to recruit market vendors […] 🆕 Nothing models a vendor. (:383)

## What it is not

Three tables already look like the right home, and each was rejected for the same reason: its
`NOT NULL` columns encode an assumption contractor work violates.

**Not `work_order`.** Its `volunteerRoleId` (restrict) and `capacity` are required and
meaningless here — an electrician holds no volunteer role, and "how many people are needed, claims
beyond this are refused" is a fact about members claiming. The decisive objection is subtler. That
design's safety property is that unscheduled work has `startsAt IS NULL`, and `NULL >= x` is NULL in
SQLite, so work orders fall out of every forward-looking query with no query changed. A contractor
engagement's central fact is an appointment. Writing "the electrician comes Tuesday 9–11" into
`startsAt` puts it straight into `listOpenShifts`, whose entire filter is
`cancelledAt IS NULL AND startsAt >= now` — so a member can claim it, `shift-reminders` emails them,
`shift-feedback` surveys them, and `complete-shifts` credits volunteer hours for work an invoice
already paid for. Six surfaces would need excluding, and until they did the failure was
member-facing email plus an inflated nonprofit metric.

**Not `purchase_order`.** The header matches — `draft → placed → received/cancelled`, an external
party, `expectedAt` driving a late list — but the meaning is lower down.
`purchase_order_line.itemId` is `NOT NULL` against the catalog, so a repair would need a "Repair
labor" pseudo-item in the table that drives loanability, reorder points and the member catalog. And
closing an order **is** recording an acquisition: `applyReceipt` takes an `acquisitionId` as
required input. Open lines also suppress restock suggestions through `onOrderQuantities`.

**Not `acquisition`.** An acquisition means goods arrived and entered stock — the rule every
`receive` movement and both money reports lean on. A labor invoice arrives as nothing. Cost
therefore lives on the job, and `spendByCategory` is left exactly as it is; the spend page gains a
second block rather than one source quietly learning to mean two things.

## What it is not, part two: the `supplier` question

`inventory-spec.md:589` declined a `supplier` table and said to revisit "when free text actually
fragments, or when one of those features forces the entity into being." Servicing forces it, for a
reason free text cannot absorb: **you never have to phone a receipt.** `purchase_order.supplierName`
works because nothing needs to reach the shop again; "who services the building and when were they
last in" is unanswerable without a row to hang a history off.

`contractor` is deliberately still **not** that `supplier` table. A supplier sells goods that arrive
and enter stock; a contractor performs work that leaves no stock behind. The same shop may one day
be both, and consolidating them is a decision to make on purpose rather than to pre-empt — which is
exactly the trap that spec was avoiding. `purchase_order.supplierName` stays free text.

The table is named `contractor` rather than `vendor` because **vendor is already ambiguous here**:
`committees-and-roles-spec.md:383` uses it for _market_ vendors — craft-fair table holders with an
application and a table fee — which is a different entity with a different lifecycle.

## Model

**`contractor`** — the party. `name`, `trade`, `contactName`, `phone`, `email`, `website`,
`licenseNumber`, `insuranceExpiresAt`, `notes`, `archivedAt`.

`insuranceExpiresAt` is a bare date with **no status column**, following `member_certification`:
current, expiring and lapsed are three readings of one date, and a stored status is a fourth thing
something has to keep true. Null means we hold no certificate, which is not the same as current —
`listLapsingInsurance` excludes it deliberately, because "never asked" and "ran out" want different
prompts and a list mixing them is unactionable.

`archivedAt` is a soft retire. `contractor_job.contractorId` restricts deletion, and the service
history is the point of the table.

**`contractor_job`** — the engagement. `contractorId` (restrict), `status`, `summary`, `assetId`
(nullable), `scheduledFor`, `expectedBackAt`, `completedAt`, `quotedCents`, `costCents`,
`invoiceRef`, `paidAt`, `requestedByUserId`, `notes`.

`assetId` is what splits the two cases the module serves. Set, it is a repair — a particular unit
goes to the shop and comes back. Null, it is building work: an electrician has no asset, and
pretending otherwise means inventing an inventory row for the breaker panel.

Statuses are `draft | scheduled | completed | cancelled`. **Late is not a state** — it is
`scheduled` with `expectedBackAt` behind us, derived the way `listLateOrders` derives it, because an
`overdue` column needs something to come along and set it and the day that fails the list quietly
empties.

## Custody

The job row and the asset's stock ledger are two records of one event. Everything that moves an
asset goes through `setAssetStatus`, never `recordMovement` — that function is the single ledger
writer and already emits `repair_out` on `→ maintenance` and `repair_in` on the way back. This is
the work-order path's own rule, which is what keeps the two from drifting into different accounts of
the same amp.

The conditions are all one-way:

| Event                                   | Asset           | Why                                                                              |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `scheduleJob`, unit `in_service`        | → `maintenance` | It has gone to the shop                                                          |
| `scheduleJob`, unit `maintenance`       | unchanged       | A second job on a unit that never came back must not write a second `repair_out` |
| `scheduleJob`, unit `on_loan`           | unchanged       | It is in a member's car, not ours to send                                        |
| `completeJob`, unit `maintenance`       | → `in_service`  | Back and working                                                                 |
| `completeJob`, unit `retired`           | unchanged       | Written off while it sat at the shop; do not resurrect it                        |
| `completeJob`, `returnToService: false` | unchanged       | The repair did not take                                                          |
| `cancelJob`                             | **unchanged**   | Calling off the tech does not mend the amp                                       |

The last row is the one worth stating out loud. Cancelling looks like it should undo the scheduling,
and undoing the scheduling would put a unit that is still broken back in front of the next member
who books it.

## Money

`costCents` is what was actually paid; `quotedCents` is what they said beforehand. `paidAt` records
that somebody settled it, the way `acquisition.reimbursedAt` does — the transfer itself happens
outside the app.

`invoiceRef` is a **string, not a file**. The one R2 bucket is served publicly at
`media.corvmc.org`, so an invoice with hourly rates on it has no business being addressable by key.
Revisit when the private bucket `CHORES.md` still owes exists.

`contractorSpend(from, to)` groups completed jobs by trade over a window, counting `completedAt`, so
a cancelled job and a quote nobody accepted contribute nothing.

## Deliberately out

- **Recurring service intervals** — extinguisher inspections, permit and licence renewals. One
  mechanism serves all three plus `inventory-spec.md:763`'s deferred maintenance scheduling, and it
  is templating rather than anything in this module.
- **A parts link.** A repair often needs a part ordered, and that is a real `purchase_order` today.
  A nullable `purchaseOrderId` joining labor and parts into one total is a column to add the day
  somebody asks, not before.
- **Member-facing anything.** Every surface is staff-only.

## Open

`work_request.contractorJobId`, once work orders land. The flag is the queue — the row that says this
unit has an unresolved problem — and a work order and a contractor job are two ways to discharge
one. It sits beside the existing `workOrderId` as a second nullable bare-`text` column rather than a
discriminator, matching `directory_entry`'s reasoning and `acquisition.purchaseOrderId`'s precedent.
Additive `ADD COLUMN`; no rebuild, no coordination needed with that branch.
