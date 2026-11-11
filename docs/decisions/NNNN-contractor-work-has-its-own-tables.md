# NNNN Contractor work has its own tables

- **Date:** 2026-09-02
- **Status:** Accepted

## Context

A damaged unit is fixed by a volunteer or by somebody the collective pays. The app recorded
neither the paid tech nor who services the building. Three existing tables looked like homes for
it: `work_order`, `purchase_order` and `acquisition`. The inventory design had declined a
`supplier` table until a feature forced the entity into being.

## Decision

1. **`contractor` is the party**: trade, contact, licence, `insurance_expires_at` and
   `archived_at`. A contractor is archived, never deleted, because the service history is the
   point of the table.
2. **`contractor_job` is the engagement**, carrying its own status, dates and money: quote, cost,
   invoice reference and `paid_at`.
3. **Late is derived**: a booked job whose `expected_back_at` has passed. No status stores it.
4. **Insurance is a bare date.** Null means no certificate is on file, which is not the same as
   current, and the lapsing list leaves it out.
5. **Custody goes through `setAssetStatus`.** Booking a repair takes an in-service unit to
   maintenance; completing it brings a unit still in maintenance back. Cancelling leaves the unit
   where it is, because the unit is still broken.
6. **The invoice is a reference string, not a file.** The one R2 bucket at the time was public.

## Alternatives rejected

- **`work_order`.** As it stood, its role and capacity were required and meant nothing for an
  electrician. A contractor's appointment in `starts_at` would have put the job on the member
  claim board, in shift reminders and feedback, and credited volunteer hours for paid work. The
  2026-10-13 record [A work order is the task](NNNN-a-work-order-is-the-task.md) later made the
  work order the task and kept `contractor_job` as the engagement on it.
- **`purchase_order`.** Its lines must name a catalog item, and receiving an order records an
  acquisition.
- **`acquisition`.** An acquisition means goods entered stock. A labour invoice brings in nothing.
  Contractor spend is reported beside equipment spend, not inside it.
- **A `supplier` table.** A supplier sells goods that enter stock; a contractor's work leaves none.
  `purchase_order.supplier_name` stays free text.
- **The name `vendor`.** It already meant a market vendor, who pays the collective for a table.

## Consequences

- Contractor spend is its own read, `contractorSpend`, counting completed jobs by `completed_at`.
- A unit's repair history reads its contractor jobs as well as its stock movements.
