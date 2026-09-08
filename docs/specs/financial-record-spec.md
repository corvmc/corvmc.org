# The financial record — what the collective earned, spent, and was given

> **Status: 📋 designed, not built.** Tracking issue: #825.
>
> Amends [finance-spec.md](shipped/finance-spec.md) rather than replacing it. That spec settled
> who owns **money movement**; this one settles who owns **accounting**. They are different
> questions and only the first was ever answered.

## What the Stripe-first decision got right, and is not being relitigated

`finance-spec.md` removed a Laravel ledger of Orders, Transactions and LineItems that mirrored
what Stripe already tracked — _"~6 models, 2 state machines, and the entire
commit/settle/sweep/reconcile lifecycle."_

That was correct and stays correct. **Nothing here mirrors Stripe.** A local row that duplicates a
Stripe charge, with its own status field tracking the same lifecycle, is the design that was
deleted, and re-creating it would re-create the reconciliation problem that motivated the deletion.
Stripe remains authoritative for what cleared, what was refunded, and what the balance is.

## What changed since

Two things, and neither was a decision anyone made.

### 1. The local financial record already exists, in ten shapes

| Table         | Money it holds                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory`   | `total_cents` `fair_value_cents` `unit_value_cents` `unit_cost_cents` `daily_rate_cents` `estimated_cost_cents` `total_charge_cents` `credits_cents` `cash_cents` |
| `ticket`      | `unit_price_cents` `contribution_cents` `acts_cents` `collective_cents` `fee_covered_cents`                                                                       |
| `audio`       | `price_min_cents` `amount_paid_cents` `platform_fee_cents` `band_net_cents` `fee_covered_cents`                                                                   |
| `contractor`  | `quoted_cents` `cost_cents` `fair_value_cents`                                                                                                                    |
| `project`     | `budget_cents`                                                                                                                                                    |
| `production`  | `guarantee_cents`                                                                                                                                                 |
| `reservation` | `cash_due_cents`                                                                                                                                                  |
| `volunteer`   | `market_rate_cents`                                                                                                                                               |
| `event`       | `ticket_price_floor_cents`                                                                                                                                        |
| `finance`     | `amount_cents`                                                                                                                                                    |

Roughly thirty money columns across ten tables. **"No local ledger" became "ten partial ledgers"** —
the maintenance cost of local money records without the one benefit a ledger gives, which is a
single query.

### 2. Most of the collective's money never touches Stripe, and structurally cannot

- **Outflow.** Contractor jobs, purchase orders, acquisitions. Stripe sees none of it.
- **Non-cash value.** A donated amp at fair value, a volunteer hour at a market rate, a donated
  performance. Real numbers on a nonprofit's books, with no payment at all. `acquisition` already
  carries `fairValueCents`, `fairValueBasis`, `intendedUse` and `appraisalRef` for exactly this.
- **Pass-through.** The band cut at the door. `reporting-spec.md` states the consequence:
  _"Cash the Collective takes in and hands straight back out … is not revenue it kept, which is why
  `production-workflow-spec.md` rejected reporting the door take to Stripe at all."_
- **Purpose.** Stripe does not know what a reservation is. Only `reservation`, `ticket` and `audio`
  carry a `stripe_payment_record_id` at all.

## The distinction

|                | Authoritative for | Answers                                                                           |
| -------------- | ----------------- | --------------------------------------------------------------------------------- |
| **Stripe**     | Settlement        | What cleared? What was refunded? What is the balance? What do we owe in fees?     |
| **This table** | Accounting        | What did we earn, spend, and receive — against what, for whom, in which category? |

They are cross-checked at the boundary, and **a disagreement is surfaced rather than silently
preferred** — the standard `reporting-spec.md` already set for the revenue line.

## Why this is not a new kind of thing here

The app has built this shape twice already, and both are load-bearing:

- **`credit_transaction`** — append-only, signed `amount`, `balanceAfter`, a `source` enum with a
  `sourceId`, a human `description`, and `metadata`. Balances are derived
  (`coalesce(-sum(amount), 0)`), never stored beside the thing they describe.
- **`stock_movement`** — append-only, signed `quantity`, a `reason` enum, an actor, an `occurredAt`.
  On-hand is derived. `inventory-spec.md` calls this the whole design.

`financial_entry` is the third of the same shape, over money instead of credits or units. That is
the argument for it: not a new pattern, the pattern this codebase already reaches for whenever it
needs to know how something got to be the way it is.

It is also why **`project.budgetCents` has no burn column beside it** — burn is derived, and today
it is derived by joining five tables that each store money differently.

## What it is not

- **Not double-entry.** No debits and credits, no balancing accounts, no trial balance. A five-person
  volunteer staff will not maintain one, and the questions being asked ("what did this project cost",
  "what did we take at the door", "what is our in-kind total for the year") do not need one.
- **Not a mirror of Stripe.** A card sale produces one entry referencing its payment record; the
  entry does not track the charge's lifecycle. Refunds are new entries, not mutations.
- **Not a general ledger or an accounting package.** It feeds reports and a bookkeeper's export. It
  does not close periods, produce statements, or replace whatever the treasurer actually files.
- **Not a replacement for the domain columns.** `ticket.acts_cents` stays where it is; it is what the
  buyer chose. An entry records what followed from that choice.

## Schema

One table.

### `financial_entry`

| Column                  | Type                          | Notes                                                                                  |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `id`                    | text pk                       |                                                                                        |
| `amountCents`           | integer not null              | **Signed.** Positive is into the collective, negative is out — as `credit_transaction` |
| `kind`                  | text enum not null            | `earned` · `spent` · `in_kind` · `pass_through` — see below                            |
| `category`              | text enum not null            | The chart of accounts, in `config.ts`                                                  |
| `occurredAt`            | integer timestamp not null    | When the money moved, **not** when the row was written                                 |
| `settlement`            | text enum not null            | `stripe` · `cash` · `credit` · `none`                                                  |
| `stripePaymentRecordId` | text, nullable                | Present when `settlement = 'stripe'`; the cross-check key                              |
| `subjectType`           | text enum not null            | House polymorphic pattern — see below                                                  |
| `subjectId`             | text not null                 | **No foreign key**, deliberately                                                       |
| `projectId`             | text → `project.id`, nullable | A real FK. `project` is the budget container, and burn reads this                      |
| `userId`                | text → `user.id`, nullable    | The member this concerns, where there is one                                           |
| `description`           | text not null                 | Human-readable, as `credit_transaction.description`                                    |
| `recordedByUserId`      | text → `user.id`, nullable    | Null for machine-written entries                                                       |
| `metadata`              | text json, nullable           |                                                                                        |
| `createdAt`             | integer timestamp             |                                                                                        |

**Append-only.** No update path, no delete. A correction is a reversing entry, which is what makes
the table answer "how did we get here" rather than only "where are we."

### The four kinds, and why they are separate from category

`kind` is what the number _means_ to the collective; `category` is what it was _for_.

- **`earned`** — revenue the collective kept. A ticket, a reservation, a membership.
- **`spent`** — money out. A contractor job, a purchase order, a reimbursement.
- **`in_kind`** — value received or given with no payment. A donated amp at fair value, a volunteer
  hour at a market rate, a donated performance. **Never summed with `earned`.**
- **`pass_through`** — money handled but not kept. The band cut at the door. It nets to zero across
  a pair of entries and must be excluded from revenue.

The separation is the point: `in_kind` and `pass_through` are exactly the two categories a naive
`sum(amount)` gets wrong, and both are already realities the app half-records. `project-spec.md`
settled the same rule for burn — **two valuations, never added** — and this preserves it rather than
re-deciding it.

### Polymorphic subject, no foreign key

`subjectType` + `subjectId` with no FK, following `media_attachment` (`attachableType` /
`attachableId`) and `stock_movement`'s untyped `loanId` / `acquisitionId`. `media-spec.md` argues
it: an entry must outlive the thing it describes. A ticket refunded and deleted, a contractor job
purged — the financial fact survives, because it is a fact about the past.

`projectId` is a real FK because a project is a container the entry belongs _to_ rather than a
subject it describes, and burn must not silently drop rows.

### Category is a config const, not a table

Unlike `local_resource_category`. A chart of accounts is **load-bearing in code** — reports group by
it, the annual report's lines are named after it, and the in-kind disclosure depends on specific
values — which is the same reason `suggestionCategories` is a const. Adding one is a deploy, and
that is correct for a value a report's shape depends on.

## Reconciliation

The one query that matters:

```
sum(financial_entry.amountCents) where settlement = 'stripe' and occurredAt in range
```

against the Stripe Reporting API's balance report for the same range. **A mismatch renders as a
mismatch.** Never silently prefer either side; `reporting-spec.md`'s rule is that a revenue figure
that quietly under-reports is worse than one that refuses to render.

This is also the check that would have caught #824, where `payment_cache` holds no card revenue at
all and two features planned to sum it.

## What folds into this

Six things currently deferred, half-solved, or resting on something that cannot answer them:

|                                   | Today                                                                                                                                                                     | With this                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **#587 annual report revenue**    | _"a design decision rather than a query to write"_                                                                                                                        | One query, cross-checked         |
| **#593 settlement**               | Plans to read `payment_cache`, which has no card revenue (#824)                                                                                                           | Entries for the event            |
| **Project burn**                  | Derived across five tables that each store money differently                                                                                                              | One `projectId` filter           |
| **Inventory spend (#605)**        | `spendByCategory()` over `acquisition` only                                                                                                                               | Contractor and PO spend included |
| **In-kind disclosure**            | `inKindContributions()` written, unused; ASU 2020-07 shaped                                                                                                               | `kind = 'in_kind'`               |
| **`ticket.paymentMethod` (#612)** | Added because _"a `pi_` prefix cannot distinguish a door sale from an online one"_, and explicitly to _"retire into a payment table when donations eventually force one"_ | `settlement`                     |

That last one names this spec as its own forcing function.

## Phases

| #   | What                                                                                         | Ships when                                     |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | The table, `financial-entry-service.ts`, the category vocabulary, seed data                  | Entries can be written and summed              |
| 2   | Write entries from the paths that already move money: checkout, `recordCashPayment`, refunds | Revenue is queryable and reconcilable          |
| 3   | Backfill from `ticket`, `reservation`, `audio` and `acquisition`                             | History is answerable, not just what follows   |
| 4   | Outflow: `contractor_job`, `purchase_order`, reimbursements                                  | Project burn is one query                      |
| 5   | `in_kind` and `pass_through`: donated goods, volunteer hours, the door split                 | The annual report and disclosure have a source |

Phase 2 before phase 3 deliberately: getting new money right matters more than history, and a
backfill written before the write path is settled gets written twice.

## Open questions

1. **Does the backfill reach Stripe?** Phase 3 can reconstruct from local columns alone, or call the
   Reporting API for the authoritative historical total. The first is cheap and approximate; the
   second is slow, rate-limited, and correct. Probably: local backfill, flagged as
   `metadata.backfilled`, with the Stripe total recorded once as a reconciliation baseline.
2. **Where does the fee live?** `fee_covered_cents` exists on `ticket` and `audio` and is money the
   member paid on the collective's behalf. One entry net of fees, or two? Two is more honest and
   doubles the row count.
3. **Does a refund reverse or annotate?** This spec says a reversing entry. That makes
   `sum()` correct at every point in time and makes "what is the current state of this sale"
   a two-row question.
4. **Who writes the pass-through pair for a door split**, and when — at settlement, or at the moment
   cash changes hands? #593 settles the first half of this.

## Not in this spec

- **Double-entry bookkeeping**, a chart-of-accounts editor, period closing, or statements.
- **Payouts.** How an act is actually paid is `stripe-connect-manual.md` and
  `ticket-sliding-scale-spec.md`'s "recorded, not routed" rule. This records that a payout happened.
- **Retiring `payment_cache`.** It can stay as the cache it is, or go once phase 2 lands. #824 is
  where that is decided.
- **Budgeting or forecasting.** `project.budgetCents` is a number to compare against, not a planning
  system.
