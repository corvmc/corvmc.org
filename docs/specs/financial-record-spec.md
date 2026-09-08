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

## Decisions

All four of this spec's open questions were settled on 2026-09-08. They are recorded as decisions
rather than deleted, because each one rejects a cheaper alternative.

### Fee coverage is a pass-through pair, not a silent netting

When a member covers processing fees, `calculateTotalWithFeeCoverage` grosses the charge up so the
collective still nets the base: on a $20 ticket the member pays ~$21.19 and Stripe keeps $1.19.

That $1.19 is money **in from the member and out to Stripe**, netting zero — the same shape as the
door split. So it is `kind = 'pass_through'`, not a fifth kind, and it is written as **two entries**
rather than folded into the earned amount.

The reason is that fee coverage is a small act of generosity repeated thousands of times, and
"members covered $X in processing fees this year" is a number worth being able to ask for. Netting
it into revenue makes it permanently unanswerable. The cost is two extra rows on every fee-covered
sale, which is the correct price for a queryable number.

### A refund is a reversing entry, never a mutation

The table is append-only, so this follows — but it would be right even if it were not.

A refund in January against a ticket sold in November: **annotating** the original row retroactively
changes November's revenue, a figure that may already have been reported. **Reversing** puts the
negative entry in January, where the money actually moved. That is simply correct, and it is the
reason to accept the cost.

Two consequences, both accepted:

- `sum(amountCents)` is correct over any window with **no status filter**. Nothing has to remember
  to exclude refunds, and the query that forgets cannot over-report.
- A **partial refund** is expressible, which an annotated status column cannot represent at all.
- "What is the current state of this sale" becomes a two-row question. That is the same trade
  `credit_transaction` and `stock_movement` already made.

Note that `payment_cache` does the opposite today — `refund()` mutates `status` to `'refunded'` —
which is one of the reasons it is a cache and not a record. See #828.

### The backfill reconstructs locally, with one Stripe baseline per period

Phase 3 rebuilds history from local columns (`ticket.unit_price_cents`, `reservation.cash_due_cents`
and the rest) rather than from Stripe's Reporting API.

Local columns record what was **intended**, not what **cleared** — they know nothing about disputes,
partial refunds, or a payment that failed and was retried, and they do not store card fees at all.
Stripe knows all of that but does not know what a reservation is, so it can supply totals with no
purpose attached.

So: backfilled entries carry `metadata.backfilled: true`, and **one Stripe-derived total per period
is recorded as a reconciliation baseline**. Purpose-attributed history at local cost, plus one
honest number per period saying what the authoritative total was — so the drift is visible to
anyone without re-deriving it.

This is the right trade only because historical figures here orient rather than attest. If a funder
or auditor ever needs numbers that survive being checked against a bank statement, that is a
different job and the baseline rows say by how much the reconstruction is off.

### The door split records the designation, the payout, and the difference

**The acts' share is anchored to the base rate, and the collective is the residual.** The scale is
an opt-up: a buyer may give the acts more than the deal specifies and may never give them less.

    divisibleCents = chargeCents − stripeFeeCents
    otherFloor     = round(baseCents      × (10000 − shareBps) / 10000)
    otherShare     = round(grossPaidCents × (10000 − shareBps) / 10000)
    otherCents     = min(divisibleCents, max(otherFloor, otherShare, buyerOptUpCents))
    shareCents     = divisibleCents − otherCents        // never below zero

`baseCents` is the event's suggested price for a ticket and the release's `priceMinCents` for a
music sale; `shareBps` is the collective's share of both the base and the surplus.

On a $10 show at the default 70/30, the acts' target is **$7 regardless of what the buyer pays**.
A buyer paying $7 sends $7 to the acts and $0 to the collective. **The collective absorbs the
discount, and it absorbs the Stripe fee**, because the acts' number is absolute rather than
proportional — it only falls once the collective's share is already zero.

**Surplus above the base rate is split, not kept.** A buyer paying $15 on a $10 show is not making
a donation to the collective; they are paying more for the same thing, and the same ratio applies
to the extra. There is no surplus term because none is needed: 70% of the gross **is** 70% of the
base plus 70% of the surplus, so the `otherShare` line does it.

Worked, base $10 at 70/30 — note that the collective funds the whole card fee in every row:

| Buyer pays | Fee   | Divisible | Acts                  | Collective |
| ---------- | ----- | --------- | --------------------- | ---------- |
| $5.00      | $0.45 | $4.55     | **$4.55** (all of it) | $0         |
| $7.00      | $0.51 | $6.49     | **$6.49** (all of it) | $0         |
| $10.00     | $0.59 | $9.41     | **$7.00**             | $2.41      |
| $15.00     | $0.74 | $14.26    | **$10.50**            | $3.76      |

Measuring the acts' share against the **gross** rather than against the divisible is the whole
point. Subtracting a gross base from a fee-reduced divisible — the obvious first formulation —
understates the extra by the entire fee and hands 70% of that loss back to the acts, which is the
same leak as #827 in miniature.

### Every split payment works this way

This is one rule in `split.ts`, not a ticket rule. Music sales follow it too, with the release's
`priceMinCents` as the base and `AUDIO_PLATFORM_FEE_BPS` (10%) as the share — so a band has a
minimum take anchored to the price it set, exactly as an act does at the door.

`audio-split.ts` today argues the opposite in its own doc comment:

> Both sides therefore fund processing in proportion to what they take, and a buyer who drags CMC to
> nothing leaves the collective with no share of the fee either — so refusing the cut costs CMC
> nothing rather than costing it money. **That property is why this needs no minimum share to be
> safe.**

That reasoning is sound and answers a different question. It protects **the collective** from being
dragged below zero. It says nothing about protecting **the band**, which is what a minimum take is
for. Both properties are wanted, and the `min(divisibleCents, …)` clamp is what preserves the first:
the collective's share reaches zero and never goes below it, so absorbing the fee can cost the
collective its cut but never its own money.

**The consequence to accept: on a small sale the collective's share is structurally zero.** A $2
music sale carries a ~$0.36 card fee — 18% of the sale against a 10% platform share — so the fee
consumes the whole cut before the band's minimum is touched. That is the correct outcome under this
rule and it should surprise nobody later.

### A split that pays nobody is free, and says so with the numbers

Below `minChargeCents` the card fee takes a share of the sale that makes running it pointless. Today
`validateSplit` (`split.ts:153`) **rejects** that sale — _"Pay nothing, or at least $2.00."_ A buyer
offering a dollar is not someone to turn away, and NOTAFLOF means the answer is not an error.

**The sale becomes free.** No charge is made, and the buyer is told **with the actual figures**,
before submitting, as the amount crosses the threshold — not as an error afterwards:

> Of your **$1.00**, card processing takes **$0.33** and only **$0.67** would reach the acts.
> **This one is on us** — no charge.

Naming the numbers is the requirement, not a nicety. "Card fees would take most of it" asks the
buyer to trust an assertion about their own money; $0.33 of $1.00 lets them see it, and it is the
same arithmetic the split bar is already showing them one row up.

Two consequences:

- **A free sale still writes an entry** — `amountCents: 0`, `settlement: 'none'`. Otherwise free
  tickets are invisible and "10 tickets, 3 of them free" cannot be distinguished from "7 tickets".
- **`event.ticketPriceFloorCents` has no validation against the dead zone.** A $1 floor is settable
  today and would put every sale on that event below `minChargeCents`. Audio already refuses a floor
  between 1¢ and `AUDIO_MIN_PRICE_CENTS`; tickets need the same rule, or a floor in the dead zone
  makes every ticket free. Folded into #827.

Nothing enforces this today: the split is a percentage of what was actually paid, so a discount is
divided proportionally and the acts absorb 70% of it. At full price they receive $6.59 rather than
$7.00, having silently paid 70% of the processing fee. See **#827**, filed and corrected from this
decision.

Both numbers are recorded, because they are different facts:

| Fact                           | When       | Entry                                                                |
| ------------------------------ | ---------- | -------------------------------------------------------------------- |
| What the buyer designated      | Sale time  | `earned` for the collective's share, `pass_through` in for the acts' |
| What the act was actually paid | Settlement | `pass_through` out                                                   |
| The difference                 | Settlement | An explicit `spent` entry                                            |

The two do not match by design: #593 pays an act `max(guarantee, door split %)`, so a band with a
$200 guarantee is paid $200 on a night when buyers designated $140. **That $60 gap is recorded, not
netted away** — it is the guarantee costing the collective money on a soft night, which is precisely
the number a programming committee should be able to see.

Recording at sale time also keeps the presale window honest: money designated for an act weeks
before the show is a liability from the moment it is designated, not from the night of, and a
revenue report run in between must not count it.

**Changing any of this is a policy decision, and it has to be visible as one.** The reason for
recording all three numbers rather than only the payout is that a discrepancy between what buyers
intended and what the act received is a thing someone chose. It must not be resolvable by
arithmetic that hides it.

## Not in this spec

- **Double-entry bookkeeping**, a chart-of-accounts editor, period closing, or statements.
- **Payouts.** How an act is actually paid is `stripe-connect-manual.md` and
  `ticket-sliding-scale-spec.md`'s "recorded, not routed" rule. This records that a payout happened.
- **Retiring `payment_cache`.** It can stay as the cache it is, or go once phase 2 lands. #824 is
  where that is decided; #828 is the refund guard that rests on it.
- **Enforcing the acts-share floor.** #827. This spec records what the split produced; it does not
  fix the control that produced it.
- **Budgeting or forecasting.** `project.budgetCents` is a number to compare against, not a planning
  system.
