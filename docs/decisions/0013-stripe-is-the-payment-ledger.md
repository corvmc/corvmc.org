# 0013 Stripe is the payment ledger

- **Date:** 2026-05-12
- **Status:** Accepted

## Context

The Laravel app kept its own ledger of orders, transactions and line items, each with a state
machine, mirroring what Stripe already recorded. Keeping the two in agreement needed a
commit, settle, sweep and reconcile lifecycle. That ledger predated Stripe's Payment Records
API and existed partly to record cash. Payment Records can hold card and cash payments in one
history.

## Decision

Stripe is the record of every payment. The app keeps no order, transaction or line-item tables.

1. A card payment is a Stripe Checkout Session. A cash payment, and a $0 payment fully covered
   by credits, is reported to Stripe as a Payment Record.
2. Each purchasable row stores the Stripe payment record id as its proof of payment.
3. The app owns only what Stripe cannot hold: member credit balances, on `user`, with every
   change written to `credit_transaction`.
4. `payment-service.ts` is generic. Callers pass line items, eligible credits and metadata; the
   service knows nothing about reservations or tickets.
5. Stripe Products are created on demand and tagged with `metadata.corvmc_key`; prices come
   from app config as inline `price_data`.

## Alternatives rejected

- **Port the Laravel ledger.** About six models and two state machines that duplicate Stripe,
  plus the reconciliation work between them.
- **Stored Stripe Price ids.** A price change would mean creating a Price in the Dashboard and
  copying its id into config. Inline `price_data` keeps the amount in one place.

## Consequences

- "Is this paid?" is one column on the purchasable.
- Revenue reporting starts in Stripe. Accounting that Stripe does not see (cash splits, outflow,
  in-kind gifts) needs its own record.
- Each domain module decides what happens after payment. The finance module does not know what
  it sold.
