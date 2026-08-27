# Finance Module — Stripe-First Design

The finance module handles payments, refunds, and member credits for the Corvallis Music Collective's SvelteKit app. The central idea: Stripe is the payment ledger, not the application. There are no local Order, Transaction, or LineItem tables. Instead, each purchasable item links directly to a Stripe Payment Record, and the Stripe dashboard is the single view of all revenue.

The module owns only what Stripe can't do: member credit wallets with double-entry bookkeeping and the logic to apply credits as Stripe coupon discounts at checkout time.

---

## Why this design

The Laravel app's finance module maintains a full local ledger — Orders, Transactions, LineItems — that mirrors what Stripe already tracks. This creates reconciliation complexity, state machine overhead (Order and Transaction each have their own state machines with hooks), and a large surface area for bugs. The local ledger exists because the original design predated Stripe's Payment Records API and needed to handle cash transactions locally.

With Payment Records, Stripe can track both card and cash payments in a unified history. The local ledger becomes redundant. Removing it eliminates ~6 models, 2 state machines, and the entire commit/settle/sweep/reconcile lifecycle.

---

## Stripe as the ledger

Every payment — card or cash — is represented in Stripe.

**Card payments** use Stripe Checkout Sessions. The app creates a session with line items (referencing Stripe Products/Prices) and a coupon if credits apply. Stripe collects payment and fires webhooks on completion.

**Cash payments** use the Payment Records API. When staff confirms cash received, the app calls `report_payment` with the amount and `processor_details.type: "custom"`. Stripe records it alongside card payments.

Both paths produce a Stripe Payment Record. The purchasable stores the Payment Record ID locally as its proof of payment.

**Products live in Stripe; prices live in app config (KV).** Each purchasable type (rehearsal reservation, event ticket, equipment loan, contribution, fee coverage) has a corresponding Stripe Product, created on demand and tagged with `metadata.corvmc_key` (see `product-config-service`). Unit amounts are stored in Cloudflare KV (editable from staff settings) and passed to Checkout Sessions as inline `price_data` — the app does not reference stored Stripe Price IDs.

**Credit eligibility is passed by the caller.** `checkout()` takes an `eligibleCredits` array (credit type + unit value in cents) from the domain module initiating the purchase. Reservations commit free-hour credits themselves before checkout (see `reservation-credit-service`) and pass an empty list.

---

## Credits

Credits are the one thing Stripe doesn't handle. The app tracks them with two integer columns on the user table for current balances and a single audit log table for history.

### Credit balances (user.creditFreeHours / user.creditEquipment columns)

Two integer columns on the `user` table hold the running totals: `credit_free_hours` (30-minute blocks — one credit covers half an hour of room time) and `credit_equipment` (cents, spendable 1:1 against equipment-loan charges). Max balances per credit type live in app config (`creditTypeConfig`): free hours are uncapped (the monthly reset overwrites them), equipment credits cap at $250.

The database is Cloudflare D1 (SQLite), which has no interactive transactions, so the CreditService uses two race-free write shapes:

- **Deductions** are a single relative decrement guarded in the `WHERE` clause (`SET col = col - ? WHERE id = ? AND col >= ?`) — a concurrent over-spend simply matches zero rows and surfaces as `InsufficientCreditsError`.
- **Additions and resets** use optimistic compare-and-swap: read the balance, compute the next value, write with `WHERE col = <read value>`, and retry (bounded) if a concurrent writer changed it.

### CreditTransaction

Immutable audit log. Every credit change — allocation, deduction, reversal, admin adjustment — creates a row.

```
credit_transaction
  id                  serial primary key
  user_id             text, FK → user.id
  credit_type         text
  amount              integer (positive = add, negative = deduct)
  balance_after       integer (snapshot of user.credits balance after this entry)
  source              text ('monthly_allocation' | 'monthly_reset' | 'checkout' | 'refund' | 'admin_adjustment' | ...)
  source_id           text, nullable (Stripe Payment Record ID, admin user ID, etc.)
  description         text
  metadata            jsonb, default '{}'
  created_at          timestamptz
```

### Credit allocation logic

Credits are allocated in response to Stripe subscription webhooks — no local scheduling table. When `invoice.paid` fires, the handler calculates the credit amount from the subscription and calls `CreditService.allocateMonthlyCredits()`. The CreditTransaction audit log records each allocation with `source: 'monthly_allocation'` and `source_id` set to the Stripe subscription ID, providing full history without a separate table.

**Free hours** reset each month to the subscription-derived amount (1 hour per $5). No rollover — the balance is set directly.

**Equipment credits** roll over with a cap (`max_balance`). Allocation adds to the current balance up to the cap.

---

## Purchasable fields

Each domain model that can be purchased (reservations, tickets, equipment loans) adds one column:

```
stripe_payment_record_id    text, nullable
```

A purchasable is **paid** when `stripe_payment_record_id` is not null. Every payment path — card, cash, or fully covered by credits — produces a Stripe Payment Record. For credits-only payments, the app calls `report_payment` with a $0 amount and `credits_applied` in metadata. This means "has a Payment Record" is the single check for payment status.

Credit amounts applied are stored in the Payment Record's metadata (`credits_applied_cents`), not locally. To find out how much credit was used, read it from Stripe.

A purchasable is **locked** (immutable except for status) when `stripe_payment_record_id` is not null. The only way to change a locked purchasable is cancel-and-rebook.

---

## Payment service

A single service handles all payment operations. It's generic — it doesn't know about reservations, tickets, or equipment. Callers build cart line items (inline `price_data` or a Stripe price reference), declare which credit types may discount the cart, and pass opaque metadata used for post-checkout linking.

### checkout(options)

```ts
checkout(options: {
  stripeCustomerId?: string;      // required for subscriptions
  customerEmail?: string;         // pre-fills Stripe Checkout when no customer
  userId?: string;                // absent = anonymous purchase, no credits
  mode: 'payment' | 'subscription';
  lineItems: CheckoutLineItem[];  // passed through to Stripe Checkout
  eligibleCredits?: EligibleCredit[]; // credit type + unit value in cents
  coverFees?: boolean;            // adds a fee-coverage line item (skipped under $1)
  metadata?: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ paid: boolean; checkoutUrl?: string; stripePaymentRecordId?: string }>
```

1. Resolve the cart total from the line items.
2. For each eligible credit type, apply whole units (rounded down — a member is never charged a full unit for a partial-unit discount).
3. Deduct the applied credits (CreditTransaction entries), reversing them if anything later fails.
4. If credits fully cover the cart: call Stripe `report_payment` with a $0 amount, return `{ paid: true, stripePaymentRecordId }` — no redirect.
5. Otherwise: create a one-time Stripe Coupon for the credit discount (payment mode only; subscription mode rejects `eligibleCredits`), create the Checkout Session, and return `{ paid: false, checkoutUrl }`. On session-creation failure the deducted credits are reversed and the coupon deleted.

Credits are deducted when the Checkout Session is created (not on completion). `cancel()` reverses them for abandoned sessions (and refuses to reverse a completed one). Note: reservations do NOT use this credit path — they commit free-hour credits at Confirm time via `reservation-credit-service` and pass `eligibleCredits: []`.

### onCheckoutComplete(sessionId)

Called by the Stripe webhook handler when `checkout.session.completed` fires.

1. Read `purchasable_type` and `purchasable_id` from session metadata.
2. Retrieve the Payment Intent ID from the session.
3. Look up or wait for the Payment Record associated with the Payment Intent.
4. Set `stripe_payment_record_id` on the purchasable.
5. Fire `PaymentCompleted` event.

### recordCashPayment(options)

```ts
recordCashPayment(options: {
  userId: string;
  amountCents: number;
  purchasableType: string;
  purchasableId: string;
}): Promise<void>
```

1. Call Stripe Payment Records API (`report_payment`) with amount, `processor_details.type: "custom"`, and metadata linking to the purchasable.
2. Set `stripe_payment_record_id` on the purchasable.
3. Fire `PaymentCompleted` event.

### refund(purchasable)

1. Fetch the Payment Record from Stripe. Read `credits_applied_cents` from metadata.
2. If the Payment Record has a non-zero payment amount:
   - Call Stripe Payment Records API (`report_refund`) for the full amount.
3. If credits were applied (`credits_applied_cents > 0`):
   - Reverse credit deductions (add back to UserCredit, create CreditTransaction with source `'refund'`).
4. Clear `stripe_payment_record_id` on the purchasable.
5. Fire `PaymentRefunded` event.

### cancel(purchasable)

For unpaid/abandoned items (e.g., checkout session expired before payment).

1. If credits were deducted for a pending Checkout Session:
   - Reverse credit deductions.
2. Clear `stripe_payment_record_id` on the purchasable (if set).
3. Fire `PaymentCancelled` event.

---

## Checkout flow — step by step

### Card payment (with partial credits)

1. Member clicks "Pay Ahead" on a reservation.
2. The reservation module commits the member's free-hour credits (`commitReservationCredits`): e.g. 2 hours of credits against a 3-hour, $45 booking leaves a $15 remainder stored in `cashDueCents`.
3. It calls `paymentService.checkout()` with a single "Practice Room Rental" line item for the $15 remainder and `eligibleCredits: []` (credits already committed).
4. Member is redirected to Stripe Checkout, pays $15.
5. Stripe fires `checkout.session.completed`; the webhook emits `checkout.completed` on the domain bus.
6. The reservation listener reads `reservation_id` from session metadata, sets `stripe_payment_record_id`/`paidAt`, and confirms the reservation.

### Fully covered by credits

1. Member clicks "Confirm" on a 1-hour reservation ($10).
2. Payment service sees user has 3 hours of free_hours credits. Fully covered.
3. Service deducts 1 hour, calls Stripe `report_payment` with $0 amount and metadata `{ credits_applied_cents: 1000 }`.
4. Sets `stripe_payment_record_id` on the reservation.
5. Returns `{ paid: true }`. No Stripe redirect.
6. `PaymentCompleted` event fires.

### Cash payment

1. Staff marks a walk-in reservation as paid with cash.
2. Domain module calls `paymentService.recordCashPayment()`.
3. Service calls Stripe `report_payment` with amount and custom processor type.
4. Sets `stripe_payment_record_id` on the reservation.
5. `PaymentCompleted` event fires.

---

## Refund flow

1. Staff clicks "Refund" on a paid reservation.
2. Domain module calls `paymentService.refund(reservation)`.
3. Service reads `credits_applied_cents` from Payment Record metadata.
4. If the Payment Record has a non-zero payment: calls Stripe `report_refund`.
5. If credits were applied: reverses them (adds back to UserCredit).
6. Clears `stripe_payment_record_id`.
7. `PaymentRefunded` event fires. SpaceManagement handles reservation status.

---

## Subscriptions

Subscriptions use Stripe Billing directly. The app creates Stripe Checkout Sessions in subscription mode. Stripe manages billing cycles, invoicing, and payment collection.

**Local state:** The `user` table has `stripe_id`, `pm_type`, `pm_last_four`, and a `subscription` JSON snapshot (subscription id, `hoursPerReset` — denominated in credits, i.e. 30-minute blocks — `creditsResetAt`, `coveringFees`, `cancelAtPeriodEnd`). The snapshot is the app's source of truth for "is this a sustaining member"; webhooks keep it in sync and mutations write through to it.

**Credit allocation:** When a subscription webhook fires (`invoice.paid`), the app calculates monthly free hours based on the contribution amount (1 hour per $5) and calls `CreditService.allocateMonthlyCredits()`.

**Sliding-scale membership:** A single Stripe Price at $5/unit/month. The member's chosen contribution is the quantity — a $25/month member has quantity 5, which also equals their monthly free hours. Changing contributions is a quantity update; Stripe handles proration.

**Fee coverage:** If the member opts to cover Stripe's processing fee, a second line item is added to the subscription for the fee amount (a separate Stripe Price). This keeps the contribution line item clean — the webhook handler reads the contribution quantity directly to determine free hours, without needing to back out fees.

---

## Event system

Synchronous purchase paths return results to their caller (the domain module decides what happens next). Webhook-driven completion fans out through a small domain event bus: `checkout.session.completed` emits `checkout.completed`, which the reservation, ticket, and band listeners consume (see `register-listeners.ts`). Notification-type events (`ticket.purchased`, `event.cancelled`, `reservation.cancelled`, …) ride the same bus.

---

## Module boundaries

### Inside the finance module

- CreditService (allocation, deduction, reversal, balance queries)
- PaymentService (checkout, cash recording, refunds, cancellation)
- Stripe webhook handler
- CreditTransaction schema

### Outside the finance module (domain modules)

- Purchasable field (`stripe_payment_record_id`) lives on each domain model's own table
- Policies for who can initiate payments, refunds, etc.
- Domain-specific logic after payment (confirming reservations, activating tickets) — called directly by the code that invokes PaymentService
- Stripe Product/Price configuration (done in Stripe dashboard or via seed script)

### What the finance module does NOT know about

- Reservation scheduling, conflicts, time slots
- Ticket validation, check-in
- Equipment availability, loan status
- Any domain-specific business rules

---

## Schema summary

### New tables (finance module)

| Table                | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `credit_transaction` | Immutable audit log of all credit changes |

### Modified tables

| Table                                                           | New columns                                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `user`                                                          | `credit_free_hours`, `credit_equipment` (integers, default 0) — running balances |
| Each purchasable table (reservations, tickets, equipment_loans) | `stripe_payment_record_id` (text, nullable)                                      |

### Removed (vs. Laravel app)

| Table          | Reason                                                |
| -------------- | ----------------------------------------------------- |
| `orders`       | Stripe is the ledger                                  |
| `transactions` | Stripe is the ledger                                  |
| `line_items`   | Stripe Checkout Session line items serve this purpose |

---

## Stripe configuration

### Products (created on demand by product-config-service)

| Product (`corvmc_key`) | Pricing source                                      |
| ---------------------- | --------------------------------------------------- |
| `contribution`         | KV config, $5/unit/month default                    |
| `fee_coverage`         | Computed per checkout (gross-up of the base charge) |
| `ticket`               | Per-event price (cents) on the event row            |
| `band_premium`         | KV config, $15/month default                        |

Each product is tagged `metadata.corvmc_key` so the service reuses it instead of creating duplicates; unit amounts are passed as inline `price_data` at checkout time. Reservations and equipment loans charge via generic line items / payment records rather than dedicated products.

### Webhooks

| Event                           | Handler                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `checkout.session.completed`    | `onCheckoutComplete()` — links Payment Record to purchasable |
| `invoice.paid`                  | Allocate monthly credits based on subscription amount        |
| `customer.subscription.updated` | Update local subscription state if cached                    |
| `customer.subscription.deleted` | Revoke sustaining member role, reset free hours balance      |

---

## Deferred

- **Caching Stripe Product/Price data locally.** Currently fetched from the API each checkout. Add webhook-driven cache if latency or API rate limits become an issue.
- **Promo codes / one-off discounts.** Stripe has native promotion codes. Could layer these on top of credit coupons, but not needed for launch.
- **Multi-item checkout.** Current design is one purchasable per Checkout Session. Bundling multiple items (e.g., reservation + equipment loan) into one session would need a way to split the Payment Record across purchasables. Deferred because the use case is uncommon.
- **Detailed receipt customization.** Stripe Checkout generates receipts automatically. Custom receipt templates can be added later via Stripe's receipt settings or a custom email.

---

## Open questions

None at this time.
