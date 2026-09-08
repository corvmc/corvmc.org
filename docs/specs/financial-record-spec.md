# The financial record

> **Status: 📋 designed, not built.** Tracking issue: #825.
>
> One append-only table recording what the collective earned, spent, and was given — the half
> [finance-spec.md](shipped/finance-spec.md) never covered. **Stripe stays authoritative for
> settlement** (what cleared, what was refunded, the balance); this owns accounting (what it was
> for, against what, for whom). Nothing here mirrors a Stripe charge or tracks its lifecycle: that
> was the Laravel ledger `finance-spec.md` correctly deleted.
>
> The case for building it, in one line: **thirty money columns across ten tables** already record
> the collective's money and no query can read them together — while outflow, in-kind value and the
> door split never reach Stripe at all.

## What gets built

1. **One table**, `financial_entry`.
2. **One service**, `financial-entry-service.ts` — a `record()` writer and the aggregate reads.
3. **Calls to `record()`** from the paths that already move money. That is the bulk of the work, and
   it is enumerated in [What writes an entry](#what-writes-an-entry).
4. **A category vocabulary** in `config.ts`, and seed data.

No new UI in phases 1–2. The reports that consume this are #587, #593 and #605.

## The table

`financial_entry` is append-only: no update path, no delete, corrections are reversing entries. That
is the shape `credit_transaction` and `stock_movement` already use here — signed amount, derived
balance, and the row explains how a total got to be what it is.

| Column                  | Type                          | Notes                                                      |
| ----------------------- | ----------------------------- | ---------------------------------------------------------- |
| `id`                    | text pk                       |                                                            |
| `amountCents`           | integer not null              | **Signed.** Positive is into the collective, negative out  |
| `kind`                  | text enum not null            | `earned` · `spent` · `in_kind` · `pass_through`            |
| `category`              | text enum not null            | The chart of accounts, a `config.ts` const                 |
| `occurredAt`            | integer timestamp not null    | When the money moved, **not** when the row was written     |
| `settlement`            | text enum not null            | `stripe` · `cash` · `credit` · `none`                      |
| `stripePaymentRecordId` | text, nullable                | Present when `settlement = 'stripe'`; the cross-check key  |
| `settlementGroup`       | text, nullable                | The pool a `pass_through` belongs to                       |
| `subjectType`           | text enum not null            | What this is about                                         |
| `subjectId`             | text not null                 | **No foreign key** — an entry outlives what it describes   |
| `projectId`             | text → `project.id`, nullable | A real FK; burn reads this and must not silently drop rows |
| `userId`                | text → `user.id`, nullable    | The member this concerns, where there is one               |
| `description`           | text not null                 | Human-readable                                             |
| `recordedByUserId`      | text → `user.id`, nullable    | Null for machine-written entries                           |
| `metadata`              | text json, nullable           |                                                            |
| `createdAt`             | integer timestamp             |                                                            |

`subjectType`/`subjectId` carry no FK, following `media_attachment` — a ticket may be refunded and
deleted, a contractor job purged, and the financial fact still has to survive.

### The four kinds

`kind` is what the number **means**; `category` is what it was **for**.

| Kind           | Is                                                                    | Rule                           |
| -------------- | --------------------------------------------------------------------- | ------------------------------ |
| `earned`       | Revenue kept                                                          |                                |
| `spent`        | Money out                                                             |                                |
| `in_kind`      | Value with no payment — donated gear, a volunteer hour at market rate | **Never summed with `earned`** |
| `pass_through` | Money handled but not kept — the acts' cut                            | Nets to zero within a group    |

`in_kind` and `pass_through` are precisely what a naive `sum(amountCents)` gets wrong, which is why
they are separated at the schema level rather than by convention. `project-spec.md` already settled
the same rule for burn: **two valuations, never added.**

### `settlementGroup`

Money can arrive in forty entries and leave in one. Nothing links an inbound entry to the payout
that discharges it, and a global `sum() == 0` does not prove one is missing, because two errors
cancel. So a pool gets a key and the invariant is read per pool:

```
sum(amountCents) where kind = 'pass_through' and settlementGroup = <event>
    == 0   settled
     > 0   money held and still owed
     < 0   paid out more than came in; a top-up mis-booked as pass-through
```

"What do we owe acts right now" is the sum over unsettled groups — a number that exists nowhere
today.

**It is a key, not a constraint.** It identifies associated rows and enforces nothing, so a pool
that legitimately does not balance is recordable and visible rather than refused. Four ledger
systems reach this same answer in four vocabularies —
[ledger-reconciliation-prior-art.md](../reports/ledger-reconciliation-prior-art.md) has the survey,
and what was deliberately not adopted.

### Category is a `config.ts` const, not a table

Reports group by it, the annual report's lines are named after it, and the in-kind disclosure
depends on specific values — so it is load-bearing in code, like `suggestionCategories`. Adding one
is a deploy, which is correct for a value a report's shape depends on.

## What writes an entry

The build checklist. Each row is a call site.

| Event                             | Entries                                                                       | Phase |
| --------------------------------- | ----------------------------------------------------------------------------- | ----- |
| Card checkout completes           | `earned` (collective's share) · `pass_through` in (acts) · `spent` (card fee) | 2     |
| …with fee coverage                | the above, plus `earned` under `fee_coverage`                                 | 2     |
| `recordCashPayment()`             | `earned`, `settlement: 'cash'`                                                | 2     |
| Purchase fully covered by credits | `earned`, `settlement: 'credit'`                                              | 2     |
| Sale below `minChargeCents`       | `earned` at `$0`, `settlement: 'none'`                                        | 2     |
| `refund()`                        | a reversing entry for each entry the sale wrote                               | 2     |
| Backfill                          | as above, `metadata.backfilled: true`, plus one Stripe baseline per period    | 3     |
| `contractor_job` completes        | `spent`                                                                       | 4     |
| `acquisition` — purchase          | `spent`                                                                       | 4     |
| `acquisition` — donation          | `in_kind` at `fairValueCents`                                                 | 5     |
| Volunteer hour approved           | `in_kind` at the role's `marketRateCents`                                     | 5     |
| Settlement pays an act            | `pass_through` out · `spent` if a guarantee tops it up                        | 5     |

### Worked: a ticket sale

$10 show, 70/30, so the acts' floor is $7.00. Figures from `fees.ts`.

| Kind                 | Category       | Uncovered ($10.00) | Covered ($10.61) |
| -------------------- | -------------- | ------------------ | ---------------- |
| `earned`             | `ticket_sales` | +$3.00             | +$3.00           |
| `pass_through` in    | `act_payout`   | +$7.00             | +$7.00           |
| `earned`             | `fee_coverage` | —                  | +$0.61           |
| `spent`              | `card_fees`    | −$0.59             | −$0.61           |
| **collective's net** |                | **$2.41**          | **$3.00**        |

**The card fee is always `spent`, whoever funded it.** Otherwise an uncovered fee is recorded
nowhere — the collective's share is already net of it — and card processing ends up queryable only
for the sales where a member paid it. Fee coverage is `earned` rather than `pass_through` because
the collective is not a conduit for it: it is revenue offset by an expense.

Record both legs even when they are equal. The gross-up solves a continuous equation and then
rounds, so on other amounts they differ by a cent, and that cent belongs in the collective's
position rather than asserted away.

### Worked: paying the acts

**The payout is not mirrored per ticket.** Forty tickets are forty facts weeks apart; one act paid
after the show is one fact. With `designated` as the sum of that act's inbound pool:

| Case                                      | `pass_through` out | `spent`                  | Rows |
| ----------------------------------------- | ------------------ | ------------------------ | ---- |
| Buyers designated more than the guarantee | `designated`       | —                        | 1    |
| The guarantee wins                        | `designated`       | `guarantee − designated` | 2    |

**The pool divides equally.** CMC takes 30% of the door and the acts split the rest among
themselves — `production_slot.percentageBps` is basis points **of the acts' pool**, defaulting to
`10000 / N` across credited slots, with the remainder distributed one basis point at a time by
`sortOrder`. Three acts get 3333/3333/3334. The same rule settles odd cents, so $841 pays
$280.34/$280.33/$280.33 rather than depending on which row the rounding lands in. A per-act override
stays for a touring act with a guarantee, or `contributed` for a donated set.

**The split is agreed at booking and applied at settlement**, from the slots as they stand then. If
an act drops off a three-band bill two days out, the remaining two split the whole pool — including
money from tickets sold when there were three. That is why the inbound is one pool row per ticket
rather than one row per act: the pool is divided among who actually played, and a lineup change
rewrites nothing. The pre-agreed split is a commitment to the act, not a ledger fact.

Three acts on an $840 pool, one on a $400 guarantee: three `pass_through` rows of −$280 and one
`spent` of −$120. Four rows, not forty. The pass-through leg carries exactly what arrived earmarked,
so the pool nets to zero; a guarantee top-up never passed through anything, so it is `spent`, and
the soft-night cost surfaces on its own.

## Rules a writer must follow

- **A refund is a reversing entry, never a mutation.** A January refund against a November sale must
  not retroactively change November — a figure that may already have been reported. `sum()` is then
  correct over any window with no status filter, and a partial refund is expressible.
- **`occurredAt` is when the money moved**, which for a backfill is not when the row was written.
- **A free sale still writes a `$0` entry.** Otherwise "10 tickets, 3 free" cannot be distinguished
  from "7 tickets".
- **Never sum `in_kind` with `earned`**, and never net a `pass_through` pair away.

### The split the entries record

The acts' share is anchored to the base rate and the collective is the residual, absorbing the
discount and the whole card fee until its share reaches zero:

```
divisibleCents = chargeCents − stripeFeeCents
otherFloor     = round(baseCents      × (10000 − shareBps) / 10000)
otherShare     = round(grossPaidCents × (10000 − shareBps) / 10000)
otherCents     = min(divisibleCents, max(otherFloor, otherShare, buyerOptUpCents))
shareCents     = divisibleCents − otherCents
```

`baseCents` is the event's suggested price or a release's `priceMinCents`; `shareBps` is the
collective's share. Measuring against the **gross** is the point — subtracting a gross base from a
fee-reduced divisible understates the surplus by the whole fee and hands most of that loss back to
the acts.

| Buyer pays | Fee   | Acts                  | Collective |
| ---------- | ----- | --------------------- | ---------- |
| $5.00      | $0.45 | **$4.55** (all of it) | $0         |
| $7.00      | $0.51 | **$6.49** (all of it) | $0         |
| $10.00     | $0.59 | **$7.00**             | $2.41      |
| $15.00     | $0.74 | **$10.50**            | $3.76      |

**This is one rule in `split.ts`, and music sales use it too** — a release's `priceMinCents` is its
base. Neither adapter implements it today; both are proportional to what was paid, so **#827 is a
prerequisite for the entries above being correct.** Below `minChargeCents` the sale is free rather
than refused, and the buyer is told with the actual figures — _"of your $1.00, processing takes $0.33
and $0.67 would reach the acts."_

## Reconciliation

```
sum(amountCents) where settlement = 'stripe' and occurredAt in range
```

against the Stripe Reporting API's balance report. **A mismatch renders as a mismatch** — never
silently prefer either side. This is the check that would have caught #824.

## Phases

| #   | What                                                                      | Done when                                      |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | Table, service, category vocabulary, seed data                            | Entries can be written and summed              |
| 2   | The write paths: checkout, cash, credits, refunds                         | Revenue is queryable and reconcilable          |
| 3   | Backfill from `ticket`, `reservation`, `audio`, `acquisition`             | History is answerable                          |
| 4   | Outflow: `contractor_job`, `purchase_order`, reimbursements               | Project burn is one query                      |
| 5   | `in_kind` and `pass_through`: donated goods, volunteer hours, door splits | The annual report and disclosure have a source |

Phase 2 precedes phase 3 deliberately: a backfill written before the write path settles gets written
twice.

**Backfill approach (phase 3):** reconstruct from local columns, tagged `metadata.backfilled`, plus
**one Stripe-derived total per period** as a reconciliation baseline. Local columns record what was
intended rather than what cleared — they know nothing of disputes or partial refunds — so the
baseline rows say by how much the reconstruction is off. That trade holds only because historical
figures here orient rather than attest.

## What folds into this

| Issue                           | Today                                                                | With this                        |
| ------------------------------- | -------------------------------------------------------------------- | -------------------------------- |
| **#587** annual report revenue  | "a design decision rather than a query to write"                     | One query, cross-checked         |
| **#593** settlement             | Plans to read `payment_cache`, which holds no card revenue (#824)    | Entries for the event            |
| **Project burn**                | Derived across five tables that each store money differently         | One `projectId` filter           |
| **#605** inventory spend        | `spendByCategory()` over `acquisition` only                          | Contractor and PO spend included |
| **In-kind disclosure**          | `inKindContributions()` written and unused                           | `kind = 'in_kind'`               |
| **#612** `ticket.paymentMethod` | Added to say "retires into a payment table when donations force one" | `settlement`                     |

## Open questions

1. **What does a refund after settlement do to a closed pool?** The act is already paid, so the pool
   goes negative and the collective ate it. That is believed correct; it should be confirmed rather
   than "fixed" by suppressing the reversal.

## Not in this spec

- **Double-entry bookkeeping**, an account tree, a chart-of-accounts editor, period closing, or
  statements.
- **Payouts.** How an act is actually paid is `stripe-connect-manual.md`. This records that one
  happened.
- **Fixing the split.** #827. This records what the split produced; it does not fix the control.
- **Retiring `payment_cache`** (#824) or the refund guard resting on it (#828).
- **Budgeting or forecasting.** `project.budgetCents` is a number to compare against.
