# Associating a pass-through in with a pass-through out — prior art

> Written 2026-09-08 while specifying `financial_entry`
> ([financial-record-spec.md](../specs/financial-record-spec.md), #825).
>
> **The question.** Door money arrives as many inbound entries — one per ticket, spread over weeks
> of presales — and leaves as one payout per act. Nothing links the two. Is `sum() == 0` the only
> evidence that a pool settled correctly?
>
> **The answer, and it is unanimous across four systems: no.** Nobody links entry to entry, and
> nobody relies on a bare global sum either. Every design surveyed uses a **grouping key** plus a
> balance read **per group**.

## Why bare summation is not enough

`sum(pass_through) == 0` across the whole table is a weak check, because **two errors cancel**. An
event underpaid by $100 and another overpaid by $100 sum to zero and look settled. The invariant
has to be per-pool to mean anything, and per-pool requires a key that says which pool a row is in.

That is the whole finding. The rest is how four systems spell it.

## 1. Clearing accounts — classical double-entry

The oldest answer, and the one the others are re-inventing: **the pool is an account.** Inbound
credits it, the payout debits it, and the account's balance _is_ the open liability. Nothing links
individual rows because nothing needs to — membership in the account is the association.

Ledger-design writing states the pattern directly: keep a clearing account for in-flight movements
and clear it on settlement, and organise accounts hierarchically so pending balances are separate
from settled ones. Trust accounting (a lawyer's IOLTA account, an escrow agent's) is the same shape
under a legal obligation: per-client sub-accounts, and a three-way reconciliation between the bank,
the control account, and the sum of the sub-accounts.

**What it costs here:** an account tree, which is most of double-entry, which
`financial-record-spec.md` has explicitly declined. **What it teaches:** the association wants to be
a _place_ rather than a link.

## 2. Stripe `transfer_group` — the same idea as a string

Directly analogous, and already in this codebase's vocabulary through Connect.

A `transfer_group` is an arbitrary shared string set on charges and on the transfers that pay them
out. Stripe is explicit about its status: it **"only identifies associated objects. It doesn't
affect any standard functionality."** It is documentation for reconciliation, deliberately not a
constraint.

Two details worth copying:

- **Stripe fills it in when you do not.** If a charge has no group, Stripe generates
  `group_<PaymentIntent id>` and assigns it to both the charge and the transfer. A platform that
  never sets one still gets grouped objects — which says Stripe treats "ungrouped" as a defect
  rather than a valid state.
- **It is many-to-many by construction.** Several charges and several transfers can share a group,
  which is exactly the forty-tickets-one-payout shape.

## 3. TigerBeetle two-phase transfers — the obligation as a state

The strongest form, from a database built for exactly this.

A **pending** transfer reserves its amount in the accounts' `debits_pending` / `credits_pending`
fields, leaving `debits_posted` untouched. It is later **posted** (moving the reserved amount),
**voided** (restoring it), or it times out. Crucially, **a post may be for less than the pending
amount**, with the remainder restored to the original accounts.

That maps onto the door split without adaptation: the designations are pending, the payout posts
them, and posting less than was designated is a first-class case rather than an error.

TigerBeetle also settles the mutation question the spec already answered independently: transfers
are append-only and immutable, and **reversals are separate transfers**, for an auditable log of
business events.

**What it teaches:** an obligation is better as an explicit state than as something inferred from a
sum. **What it costs here:** a `pending`/`posted` distinction on every entry, which is more
machinery than one venue's door needs.

## 4. Reconciliation metadata — the general-ledger convention

The broader ledger-design literature says every posting should carry the metadata to link it to an
external event: provider reference, payment id, **settlement batch**. It also names the shape
directly — one-to-many and **many-to-one matching is the normal pattern** for partial payments,
installment billing, batch settlements and consolidation, not an edge case to design around.

So: a batch identifier, and matching at batch granularity.

## What this means for `financial_entry`

**Add a grouping key.** Everything above is the same recommendation in four vocabularies:

```
settlementGroup   text, nullable      -- the pool this entry belongs to
```

For the door split that is the event's act pool. The invariant becomes readable per pool rather
than only in aggregate:

```
sum(amountCents) where kind = 'pass_through' and settlementGroup = <event>
    == 0   settled
     > 0   money held and still owed
     < 0   paid out more than came in — a guarantee top-up mis-booked as pass-through
```

Three properties follow, and none of them exist under bare summation:

1. **Errors stop cancelling.** Each pool is checked on its own.
2. **The open liability is a real number.** "What do we owe acts right now" is
   `sum(pass_through) where settlementGroup is unsettled` — a figure that presently exists nowhere.
3. **It stays a key, not a constraint.** Following Stripe: it identifies associated rows and
   enforces nothing, so a payout that legitimately does not balance its pool is recordable and
   _visible_ rather than rejected.

**What is deliberately not adopted:** a full account tree (declined with double-entry), and
TigerBeetle's pending/posted state machine (more than this scale needs). If the pass-through volume
ever grows past the door — merch consignment, artist commissions — the two-phase model is the thing
to reach for, and this note is where to start.

## Not in this report

Which allocation rule divides an event's designated pool among several acts on a bill. That is a
production question, not a ledger one — see #593.

---

Sources: [Stripe funds segregation](https://docs.stripe.com/connect/funds-segregation) ·
[Stripe separate charges and transfers](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/separate-charges-and-transfers) ·
[TigerBeetle two-phase transfers](https://docs.tigerbeetle.com/coding/two-phase-transfers/) ·
[TigerBeetle transfer reference](https://docs.tigerbeetle.com/reference/transfer/) ·
[Ledger system design principles](https://fintechly.com/infrastructure/infrastructure-ledger-system-design/) ·
[Real-time ledger with double-entry logic](https://finlego.com/blog/designing-a-real-time-ledger-system-with-double-entry-logic)
