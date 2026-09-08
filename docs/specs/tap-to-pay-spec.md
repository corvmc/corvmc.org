# Tap to Pay at the door

**Status:** 📋 Spec — nothing built. Android only, one sideloaded handset, no app store. Phase 0 is
one Stripe Location and an afternoon. The code is sequenced behind #522.

[#612](https://github.com/corvmc/corvmc.org/issues/612) asked for "a registered-device concept for a
terminal in the space — check-in, door access, or a walk-up booking screen", inherited from a
Laravel `KioskDevices` resource whose purpose was never written down. It has been redefined: a
SvelteKit + Capacitor app using **Stripe Terminal** to accept **Tap to Pay** payments on a phone
somebody is holding.

Two things fall out of that redefinition before any of the design, and they are the two sentences
worth remembering from this document.

**Tap to Pay cannot be a kiosk.** The reader disconnects the moment the app enters the background or
the phone loses connectivity. Auto-reconnect exists, but the app must be foregrounded to take money
at all. There is no configuration that changes this; it is what the reader is.

**Going Android-only deleted the schedule.** Tap to Pay on iPhone needs two Apple entitlements
granted on Apple's timetable, a business Apple ID, an acceptance of Apple's own Terms and
Conditions, and an instructional overlay integrated before App Review. Android Tap to Pay needs a
Stripe Location and a phone that meets a checklist. An earlier draft of this spec opened with a
procurement phase that blocked everything and could not be hurried. That phase is gone. Nothing here
waits on a third party's queue.

## The thing this settles first

Every one of #612's three original uses is _unattended_: a device left on a stand doing its job
while nobody watches it. Check-in, door access and a walk-up booking screen all assume the app runs
unheld, for hours, and that a member walks up to it. Tap to Pay assumes the opposite — a staffer
holding a phone, per transaction, presenting it to one customer at a time.

So this spec serves the attended half and scopes the unattended half **out**, permanently, as
something Tap to Pay is the wrong hardware for rather than something we chose not to build. What
those cases actually need is a Stripe **smart reader** (S700 or WisePOS E) — which is also, not
coincidentally, the only reader category that supports tipping and collecting input on its own
screen. See [Deliberately out](#deliberately-out) and [Open](#open).

## What it is not

Three homes look right, and each is rejected by something structural rather than by taste.

**Not the `/checkout/[id]` Payment Element page.** First, a correction to anyone reaching for it:
that page does not exist on `main`. It is #522's, on `feature/in-house-checkout`, along with
everything else under `src/lib/server/finance/gateway/`. Second, and decisively, the Payment Element
is **card-not-present**. A Terminal payment is card-present: its PaymentIntent is created with
`payment_method_types: ['card_present']` and confirmed by the SDK on the device, not by
`stripe.confirmPayment` in a browser, and the Element cannot render a card-present method at all.
There is nothing to reuse but the route shape — and the route shape is wrong too. `/checkout/[id]`
is a URL a **buyer** opens in their own session. At the door there is no buyer session: the phone is
the staffer's, and the person paying never touches software.

**Not the check-in surface.** `/staff/events/[id]/check-in` is close enough in _place_ to be
tempting, and it is the wrong _model_. `getStaffCheckIn(eventId)` returns a list of `ticket` rows;
`checkInTicket` takes a `ticketId`; `ticket.code` is `NOT NULL` and `.unique()`, minted by
`createTickets` before anybody can be checked in. Every action on that page starts from a ticket
that already exists and has already been paid for, and `checkIn` only ever moves `valid →
checked_in`. A door sale runs the other way — money first, ticket second, and the ticket is checked
in the instant it is minted because the person is already through the door. Folding the two together
means one screen holding a list keyed by `purchaseId` and a create path with no purchase, which is
two features sharing a URL. The door screen may well end up **next to** it in the nav; that is a
navigation decision, not a reason to share a model.

**Not a new payment product.** `ProductKey` in `product-config-service.ts` is a closed union —
`contribution | fee_coverage | ticket | ticket_contribution | band_premium | audio_release` — and
adding `'door_ticket'` to it mints a **second Stripe product for the same revenue**. One show's
ticket money would then split across two products in Stripe's own reporting, and #593's settlement
worksheet would have to know to add them back together, forever. The distinction the schema already
has a column for is not product but **method**: `payment_cache.paymentMethod` is free text and
already carries `'Cash'`, `'Credits'` and a Checkout display name. Tap to Pay is a new value in that
column, not a new entry in that union.

## There is no device registry

#612's title is `Kiosk Devices`, and this spec does not add a device table. The argument is short
because the evidence is one-sided.

Tap to Pay readers **need no registration** — not in the Dashboard, not through the API. The phone
is bound to a Stripe **Location** at `connectReader` time by passing `locationId`, and that is the
whole of Stripe's device-side bookkeeping. So a `kiosk_device` row cannot be justified as Stripe
plumbing. It would have to answer a question CMC has, and there is exactly one:

> Which handset, held by which staffer, took this money on which night.

At the scope this is being built to — **one phone, one Location, one operator at a time** — two
thirds of that question have constant answers and the third is the session. _Which handset_ is the
handset. _Which night_ is `paidAt`. _Which staffer_ is who was logged in, which is a column
(`staffUserId`) on the payment row, not a table.

Nor would a device row buy control. A self-reported device identifier is an audit convenience: the
app reports whatever the app says, and a tampered handset reports a handset that has not been. The
real device gate is the one **Stripe already enforces** in `connectReader` — see [What the phone has
to be](#what-the-phone-has-to-be) — and it checks things an allowlist of ours could not, like
whether the bootloader is locked.

**So: no table, no column.** The device is not modelled at all. The trigger to revisit is a _second_
phone, at which point the question stops having a constant answer and a `deviceLabel` column becomes
the cheapest thing that answers it; an allowlist table is only worth it the day CMC wants to
**refuse** an unregistered handset, which is a different feature with a registration gesture and a
revoke. This resolves #612 by dissolving its premise rather than honouring its title.

## What the phone has to be

`connectReader` enforces a device checklist and fails if any of it is untrue. In full, so nobody
buys the wrong phone:

- Not rooted; bootloader locked and unchanged; unmodified manufacturer OS
- **Android 13 or later**
- Security patch level within the last 12 months
- Google Mobile Services, with the **Play Store app installed**
- Hardware keystore with ECDH — `FEATURE_HARDWARE_KEYSTORE` version ≥ 100
- A stable internet connection
- **Developer options disabled**
- Not itself a certified PCI PTS payment device

Two of these have consequences big enough to have their own sections: Developer options
([below](#installing-a-build-and-taking-money-are-mutually-exclusive)), and the Play Store
requirement, which is the load-bearing assumption in [Open](#open) item 1.

Supported at the tap: Visa, Mastercard, **Amex, Discover**, and Google/Samsung Pay, plus **PIN
entry** and **QR-based payment methods**. Android Tap to Pay is a fuller reader than the iPhone one
in this respect. What it still does not do is **tipping** or **collecting any input on its own
screen** — see [Money](#money).

**Offline is unavailable.** Not "preview", not "by request" — Android Tap to Pay has no offline
mode. The door needs working connectivity, full stop. That is a flat constraint on the venue, and it
is the reason the architecture below can be recommended without hedging.

## Installing a build and taking money are mutually exclusive

This is the sharpest operational fact in the spec and it is a direct collision with sideloading.

You enable Developer options to `adb install`. `connectReader` refuses to connect while Developer
options are enabled. **The phone cannot be in both states.** So installing a build is a procedure,
not a step:

1. Enable Developer options and USB debugging.
2. `adb install -r` the new build.
3. **Disable Developer options.** Reboot.
4. Before the doors open, connect against a simulated reader and take one test payment.

Step 4 is not ceremony. It is the only way to find out the phone is in a bad state at a time when
that is fixable, because the failure at the door is worse than a refusal to connect.

**PIN collection fails independently, and quietly.** `TAP_TO_PAY_INSECURE_ENVIRONMENT` is raised
when Developer options are on, an accessibility service is running, screen recording is active,
there are screen overlay windows, or anybody attempts a screenshot. PIN is required above the
regional contactless CVM limit — so a phone in a slightly wrong state **takes small payments fine
and fails only the large ones**, at the moment the customer is standing there, and it presents as
something wrong with their card.

Three requirements follow, and they belong in the build rather than in a runbook nobody reads:

- The door screen must surface `TAP_TO_PAY_INSECURE_ENVIRONMENT` **as itself** — "this phone is in a
  state that can't take PINs" — and never as a generic decline. Anything less blames the customer
  for the venue's configuration.
- The app should check the environment **at connect time**, not at first PIN, so the problem
  surfaces before there is a queue.
- No screenshots on the door phone, ever. That rules out screenshot-based debugging, and it means a
  staffer's habit of screenshotting a receipt breaks the next large sale.

Worth saying plainly rather than burying: **a running accessibility service is on that forbidden
list.** A staffer who needs a screen reader cannot use this phone to take a PIN payment. That is
Stripe's constraint and not one we can engineer around, and it is a reason the door should never
depend on exactly one person's handset.

## The tap screen

`setTapToPayUxConfiguration` controls the colors, dark mode behaviour and tap-zone position of the
screen the customer looks at. It is **the only branded surface in the entire flow** — the customer
never sees the staff UI — so it is worth the ten minutes.

Use the CMC palette from `design-system/project/colors_and_type.css`: orange `#e5771e` as the
primary, navy `#003b5c` for dark surfaces, cream `#fffbf6` for light. The Location's `display_name`
is customer-facing copy that appears here too, and should read "Corvallis Music Collective" rather
than an internal identifier.

The no-gradients rule applies here as everywhere. The configuration takes flat colors anyway, which
makes this easy to comply with by accident; state it so nobody reaches for a drawable.

## Model

The schema question reduces to one thing: where a door payment gets recorded.

### `payment_cache.userId` is `NOT NULL`, and a door sale has no account

`paymentCache` (`src/lib/server/db/schema/finance.ts:69`) has `userId` `NOT NULL` referencing
`user.id` with `onDelete: 'cascade'`, indexes on `user_id`, `reservation_id` and `paid_at`, and —
the fact that decides this — **three `innerJoin(user, …)`** in `payment-cache-service.ts` (lines
121, 129, 141), which is how every staff payments query resolves `member`.

A person who walks up at the door has no account, and requiring one to buy a ticket is exactly the
barrier the door exists not to have.

**(a) Make `userId` nullable.** The migration is not the cost. The three inner joins are: an inner
join **silently drops** a row whose FK is null, so every anonymous door sale would vanish from the
staff payments list, its search and its count, with no error raised anywhere. Fixing that is three
`leftJoin`s plus making `PaymentCacheRow.member` nullable, which pushes a null through `MemberRef`
into every consumer of that type. And `onDelete: 'cascade'` becomes a lie for part of the table —
purging a member must not take door revenue with it.

**(b) A sentinel walk-up user.** Keeps every join, index and consumer working untouched. The cost is
a `user` row that is not a person, now appearing in the member list, the directory, the member
count, campaign audiences, community stats, and `listUsersWithCapability` the moment it is granted
anything. Each is a filter somebody has to remember to add, and the failure mode is a **wrong number
on a nonprofit's report** rather than an error anyone sees. `ticket.userId` was made nullable
instead, for exactly this reason.

**(c) A separate `terminal_payment` table.** Its own row per card-present take.

**Recommend (c).** Three reasons, in order of weight:

1. `payment_cache` means _a payment by a member_. That is what its `NOT NULL` FK, its cascade, its
   `idx_payment_record_user` and its three inner joins all independently encode. It is also, per its
   own header comment, a **cache of Stripe Payment Records** — and a card-present PaymentIntent is
   not one of those.
2. The row we want to write has a field `payment_cache` has no column for and never will: the
   **operator**. A door payment has a buyer who may not exist and a staffer who always does. Putting
   a nullable buyer and a `NOT NULL` staffer into a table whose entire shape is one-user-per-row
   makes it two tables wearing one name.
3. It leaves the cascade honest, and leaves the existing consumers alone.

**`terminal_payment`** — `id`, `paymentIntentId` (unique, the `pi_…`), `staffUserId` (`NOT NULL`,
restrict), `buyerUserId` (nullable, `set null`), `amountCents`, `currency`, `status`, `purpose`,
`purchaseId` (nullable), `locationId`, `paidAt`, `refundedAt`.

No device column, per [above](#there-is-no-device-registry). `locationId` is kept where the device
is not, and the asymmetry is deliberate: the reconciliation sweep lists PaymentIntents **by
Location**, so denormalising it makes the match cheap — and a second venue is a far more plausible
future than a second phone.

`purpose` is deliberately not a discriminated FK set. It names what the money was for
(`door_ticket`, `donation`, …) and `purchaseId` is a bare nullable `text`, matching what `ticket`
already does: `ticket.purchaseId` is `NOT NULL text` with **no FK and no purchase table**, indexed
as `idx_ticket_purchase`. A door sale mints its tickets under a fresh `purchaseId` exactly as the
online flow does, and `terminal_payment.purchaseId` is how the two find each other. This follows
`directory_entry`'s reasoning and `acquisition.purchaseOrderId`'s precedent, both cited in
`contractor-work-spec.md`.

`ticket.stripePaymentRecordId` is a nullable `text` already holding proof of payment, and a `pi_…`
id fits it — which matters more than it looks, because `refund()` in `payment-service.ts` already
branches on that exact prefix.

### Status moves

`terminal_payment.status` moves by atomic conditional update with a row-count check, never
read-then-write:

```sql
UPDATE terminal_payment
   SET status = 'refunded', refunded_at = ?
 WHERE id = ? AND status = 'captured'
```

Zero rows affected means somebody else already refunded it — return without calling Stripe. This is
`refund()`'s existing idempotency guard tightened: that one does a `SELECT` and then an `UPDATE`,
which is a race under concurrency. `db.transaction()` is unavailable on D1 and `db.batch([...])`
gives no read-your-write inside the batch, so the condition has to live in the `WHERE` clause. The
D1 constraint produces the better design here rather than a worse one.

## Money

**Every amount is decided in our UI, before the tap.** Tap to Pay readers support neither tipping
nor collecting input on the reader screen — the one capability gap that Android's fuller feature set
does _not_ close. The customer's only interaction with the hardware is the tap, plus a PIN when the
amount requires one.

That reconciles cleanly with `ticket-sliding-scale-spec.md`, and it is worth saying explicitly. The
sliding scale is a control on **our** screen: suggested price, per-event floor, the two-way split
bar with card processing as a locked third slice. At the door the staffer operates it — the buyer
says a number out loud, the staffer sets it, and the reader is handed a single final integer.
Nothing about the scale needs to move.

The consequence: **there is no path to a band tip collected at the reader.** The allocation the
split bar records still lands on the ticket rows (`actsCents`, `collectiveCents`) the way it does
online, because that allocation is recorded and not routed. But the thing a coffee-shop terminal
does — offering the customer a tip on the reader's own screen once the amount is set — does not
exist on this hardware and cannot be added to it. It is a smart-reader feature.

Three smaller money facts, each of which is a bug if missed:

- **Card-present pricing is not card-not-present pricing.** The sliding-scale bar draws the
  processing fee as its own labelled slice, so the constant behind it is **visible to the buyer**,
  not merely wrong in a report. Whatever fee model `fee_coverage` and `ticket.feeCoveredCents` use
  must be method-aware. Confirm the current card-present numbers against Stripe at build time rather
  than copying the online ones.
- **Free stays free.** `ticket-sliding-scale-spec.md` mints ticket rows immediately at `$0` without
  touching Stripe. At the door that means the reader is never engaged for a free ticket — also
  required, since a zero-amount PaymentIntent is not a thing.
- **There is a gap under Stripe's minimum charge.** The scale's floor defaults to `$0` and Stripe
  will not process below its minimum. The door UI must round that band **down to free** rather than
  raise an error, because the alternative is telling somebody who offered a quarter that their money
  was declined.

## The app

**A Capacitor shell whose `server.url` points at the live site.** The webview _is_ corvmc.org. The
only native surface is the Terminal plugin bridge. With no app store in the picture this is not a
trade-off to weigh — it is simply the right answer, and the fallback an earlier draft carried has
been cut to the paragraph at the end of this section.

The reason is not "least code", though it is that. **Remote functions are this repo's security
boundary** — they are the only guard, they take their params from a client header, and they rely on
the session cookie. Pointing the webview at the real origin means every remote call is made exactly
the way every other page in the app makes it: same origin, same cookie, same guard, nothing new to
get right. A separately-origined app would make every one of them a cross-origin call, and the
failure mode of getting `SameSite` or CORS wrong there is not a broken page — it is a guard reading
the wrong session.

**Dependencies.** `@capgo/capacitor-stripe-terminal` (MPL-2.0, a maintained fork of
`@capacitor-community/stripe`); its major version must match the Capacitor major (v8 ↔ Capacitor 8).
Underneath, `com.stripe:stripeterminal-taptopay` and `com.stripe:stripeterminal-core` (5.8.0 at time
of writing). The plugin's floor is min SDK 26, but **Stripe's Android 13 requirement is the binding
one** — do not read 26 as the device floor.

Plugin surface: `initialize()`, `discoverReaders()`, `connectReader()`, `collectPaymentMethod()`,
`confirmPaymentIntent()`, `disconnectReader()`, plus event listeners.

The one cost of this shape is that it **requires connectivity** — which costs nothing, because
Android Tap to Pay has no offline mode either way. There is no offline path to lose.

_(For the record, the alternative once considered was a second `adapter-static` SPA target built
from this repo. It is not recommended: it would put the app on a different origin, forcing CORS on
`/_app/remote/*` and `SameSite=None` on the session cookie, and remote function URLs carry a module
hash, so a phone that had not updated could not call a redeployed server. It is written down only so
nobody re-derives it.)_

### The connection token

`initialize()` takes a connection-token source. The token is a bearer for the Stripe account, so who
may mint one is a capability question, not a configuration question.

- **Preferred:** the webview calls a guarded remote `query`, which checks a capability and returns
  the secret, and the JS hands it to the plugin. The boundary stays where the repo puts it and no
  new public route exists.
- **Fallback**, if the plugin insists on fetching a URL itself: a `+server.ts` endpoint. Note before
  choosing this that **a native HTTP client does not share the webview's cookie jar**, so such an
  endpoint could not be guarded by the session at all. It would need its own credential, and the
  only precedent in the repo is the `CRON_SECRET` bearer pattern under `src/routes/api/cron/` — a
  shared static secret, which is a poor fit for a phone carried around a venue.

Which of the two the plugin supports is [Open](#open) and should be settled before phase 2 starts.

### Where the code goes

- The Capacitor project is a new top-level directory, and `scripts/coverage.spec.ts` fails on any
  source file that no tsconfig project compiles. It must be added to `tsconfig.tooling.json` in the
  same PR that creates it.
- **Terminal is a third `PaymentGateway` driver**, beside `stripe-gateway.ts` and `fake-gateway.ts`.
  Verified: nothing exists under `src/lib/server/finance/gateway/` on `main` — the port,
  `gateway.contract.spec.ts` and `PAYMENTS_DRIVER` are all on `feature/in-house-checkout` (PR #522,
  still draft). **This work is sequenced behind #522 landing.** Built against `main` instead, it
  becomes a fourth hand-rolled Stripe call site that has to be rewritten the week #522 merges.
- The door screen is a `<domain>/` component folder — it imports remote functions, so it cannot live
  in `ui/`. Forms use `$lib/components/ui/Form/`. No gradients.

## What it sells

**First: door tickets.** The money already has a model (`ticket`, `purchaseId`, `unitPriceCents` and
the split columns), the sliding-scale UI is being built anyway, the surface it belongs beside
already exists, and **#593 needs it** — door revenue is precisely the number the settlement
worksheet is missing, and today it is a paper tally somebody types in later or does not.

The rest follow rather than lead, and for different reasons:

- **Donations.** The cheapest possible second surface and the best phase-4 candidate: one amount, no
  product to fulfil, no ticket to mint, a receipt.
- **Membership dues.** Follows, and not merely later — it is a different Stripe flow. Dues are a
  **subscription**; a card-present PaymentIntent is a one-off. Signing somebody up at the door means
  saving a card-present payment method for future off-session use, with its own questions about
  consent and about what happens when it fails in month three. A one-off "pay a month" is possible
  but is not what membership means here.
- **Merch (#580).** Follows. #580 is _consignment_ — inventory, splits, payouts — and none of that
  is modelled. The payment method is the easy part of it; Tap to Pay does not unblock it.
- **Market vendor table fees (#609).** Follows. #609 also has no model (nothing represents a vendor,
  a table or a market day), and its own text already notes that its check-in is close in shape to
  `/staff/events/[id]/check-in`. It inherits this work; it does not motivate it.

## Refunds

A card-present payment is a `pi_…` PaymentIntent, and `refund()` already branches on that prefix —
but both its idempotency guard and its status write target `payment_cache`, which a
`terminal_payment` row is not in. So the Terminal path gets its own guard, in the atomic conditional
form given under [Status moves](#status-moves).

**Who:** `finance.refund` exists as a capability today and should stand as-is — refunding a door
sale is the same act as refunding a reservation, and it would be strange for the venue to be the one
place with looser rules. What must **not** happen is granting refund automatically to whoever holds
the capability that takes door payments. Taking money and giving it back are different authorities,
and the door is the least supervised place in the building.

#579 (spending ceilings) is the natural eventual home for "staff may refund up to $N without
escalation", and a door refund is close to the best argument for why that issue exists. This spec
does not depend on it and should not wait for it.

**Refunds are not issued on the device.** Stripe supports in-person refunds on some readers; there
is no reason to want one here. A refund is a staff action on the staff site, which keeps it to one
path with one guard and one record — and it keeps the door phone doing the one thing it is in a
verified state to do.

## Reconciliation

1. `collectPaymentMethod()` then `confirmPaymentIntent()` on the device; the SDK returns the
   confirmed PaymentIntent.
2. Stripe's **`payment_intent.succeeded` webhook** writes `terminal_payment` and mints the `ticket`
   rows under a fresh `purchaseId`, with `ticket.stripePaymentRecordId` set to the `pi_…` id. Two
   writes with no read between them, so `db.batch([...])`; never `db.transaction()`.
3. The webview also calls a guarded remote `form` with the PaymentIntent id, so the staffer sees the
   ticket immediately rather than waiting on a webhook. **The server re-reads the intent's status
   from Stripe** — the client's word that a payment succeeded is not evidence of anything. Both
   writers are idempotent on `terminal_payment.paymentIntentId` being unique, so whichever arrives
   second is a no-op.
4. #593's settlement worksheet sums ticket revenue and reads both `payment_cache` and
   `terminal_payment`. The two never overlap: a payment is either card-not-present through Checkout
   or card-present through the reader.

Step 2 being the **primary** writer and step 3 an optimisation is the whole point of the ordering.
The failure that matters is the tap succeeding and the network dropping before the app can tell us —
money taken, no ticket, customer standing there. Making the phone the only reporter turns that into
a lost sale nobody can reconstruct; making the webhook the reporter makes it a two-second delay.

A periodic sweep is still worth building as the backstop: list card-present PaymentIntents for the
Location since the last run, match on `paymentIntentId`, and surface unmatched ones on a staff
screen for a human to attach or refund. Webhooks are delivered, not guaranteed.

## Testing

**Be honest about where automation stops, because it stops earlier than usual.**

Stripe's Android Terminal SDK **does not support emulators, and enforces the same device
requirements for the simulated reader as for a production one.** There is no hardware-free path to
`connectReader`. So the payment path cannot run in CI at all — not in the e2e job, not in a unit
project, not on any runner we have. This is a genuine hole and no amount of test scaffolding closes
it.

**What is automatable**, and should be covered properly precisely because it is all we get:

- The **connection-token endpoint**: that it exists, that it refuses a caller without the capability,
  and that it never returns a token to an unauthenticated session.
- The **Terminal `PaymentGateway` driver** against `gateway.contract.spec.ts` (#522), with
  `fake-gateway.ts` standing in for Stripe. This is where amount handling, the free-ticket path and
  the below-minimum rounding get tested.
- **Reconciliation**: the webhook writer, the remote-form writer, their idempotency on
  `paymentIntentId`, and the settlement read across `payment_cache` and `terminal_payment`.
- The **door screen** in e2e, with the plugin stubbed at the `window` boundary — the sliding-scale
  controls, the amount that would be sent, and the `TAP_TO_PAY_INSECURE_ENVIRONMENT` message
  rendering as itself rather than as a decline.

**What is manual, on the one handset, every time:** everything from `connectReader` onward. Discovery,
connection, the tap, PIN, the tap-screen branding, decline handling, and the post-install check in
step 4 of [the install procedure](#installing-a-build-and-taking-money-are-mutually-exclusive). Write
that down as a checklist somebody follows before doors, because it will not be caught by anything
else.

The fake gateway and the simulated reader are **not the same thing** and neither substitutes for the
other: `fake-gateway.ts` replaces _our Stripe client_, runs offline, and is a server-project spec;
the simulated reader replaces _the hardware_ behind a real test-mode Stripe account and still needs
the qualifying phone.

Tests are colocated **`.spec.ts`, never `.test.ts`** — the vitest globs match only `.spec`, so a
misnamed file silently never runs and reports nothing. The blast radius for anything under
`src/lib/server/finance/` is the **whole directory**, because those specs mock `drizzle-orm` export
by export and one new operator breaks a sibling.

## Phases

**Phase 0 — the assumption test, then a Location.** Half a day, no code, and it is the gate on
everything else. Install a trivial Capacitor build on the actual phone, disable Developer options,
and call `connectReader` against a simulated reader. If that succeeds, sideloading works and the
plan holds; if it fails, [Open](#open) item 1 has been answered the hard way and the whole approach
needs rethinking before anything is scheduled. Then create a Stripe **Location** with a
customer-facing `display_name`, and confirm the handset against
[the checklist](#what-the-phone-has-to-be).

**Phase 1 — the driver.** Behind #522. Terminal as a third `PaymentGateway`; `terminal_payment`; the
webhook writer; the reconciliation sweep. No app work yet, and all of it automatable.

**Phase 2 — the shell.** Capacitor project, `server.url`, the connection-token path, the plugin
bridge, `setTapToPayUxConfiguration` with the CMC palette, and the install procedure written down
where whoever holds the phone will find it.

**Phase 3 — the door screen.** Sliding-scale controls, mint-and-charge, checked in on mint, sitting
beside `/staff/events/[id]/check-in`. Extend `scripts/seed-dev.ts` so the screen has realistic local
data, and add the row to `docs/reports/feature-catalog.md`.

**Phase 4 — donations.** The cheapest second surface, and the one that proves the model generalises
past tickets.

## Deliberately out

- **The unattended kiosk** — check-in, door access, a walk-up booking screen. All three are things a
  device does while nobody is holding it, and the reader disconnects the moment the app backgrounds.
  A hardware conclusion, not a scope preference, and the single most important thing this spec
  settles. Those cases need a smart reader (S700 / WisePOS E).
- **A device registry.** See [above](#there-is-no-device-registry). One phone, one Location, one
  operator: no table and no column.
- **iOS.** Not a hedge — a decision. It reintroduces two Apple entitlements, a business Apple ID,
  Apple's Terms and Conditions acceptance, an instructional overlay required before review, and an
  App Review that may object to a webview shell. All of that is schedule we do not currently have to
  spend.
- **Tipping.** Unsupported on Tap to Pay readers. Not a software feature we can add.
- **Collecting anything on the reader screen** — a receipt email, a signature, the sliding-scale
  choice. Every decision happens on our screen first; the customer taps.
- **Incremental authorizations.** Unsupported on this reader.
- **Offline payments.** Unavailable on Android, full stop.
- **In-person refunds on the device.** See [Refunds](#refunds).
- **Stripe Connect, or routing money to acts.** Unchanged from `ticket-sliding-scale-spec.md`:
  recorded, not routed. A touring band should never need a Stripe account to get paid for playing a
  show.

## Open

1. **Does a sideloaded app actually pass attestation?** This is the load-bearing assumption under
   the whole plan and it is not confirmed. Stripe's documentation requires the **device** to use GMS
   and have the Play Store app installed, and states **no requirement that the app be distributed
   through Google Play**. Attestation reads as a device verdict rather than a Play
   app-recognition verdict, which is why sideloading looks permissible — but the docs do not
   explicitly bless it, and this spec is not going to assert it either way. Settle it by doing
   phase 0's test: install on the real phone, disable Developer options, call `connectReader`
   against a simulated reader. It is cheap, it takes an afternoon, and **nothing else should be
   scheduled until it has been done.**
2. **Which capability gates taking a payment.** `finance` currently holds `read` and `refund`; there
   is no `finance.collect`. Adding one is a line in `src/lib/config.ts` plus a matrix decision about
   which positions hold it. It should not be `event.manageTickets` — that capability is about the
   show, not about the money.
3. **Can `@capgo/capacitor-stripe-terminal` be handed a connection token directly**, or does it
   insist on fetching an endpoint? Decides whether a new public `+server.ts` route exists at all,
   and therefore whether the security boundary stays in one place.
4. **Whose phone is it, and what happens when that person is not working?** One handset means one
   point of failure, and the accessibility-service constraint above means it cannot simply be
   whoever's phone is nearest. A second qualifying device kept in the building is the obvious answer
   and is also the trigger for revisiting the device registry.
5. **Does CMC want an S700 for the unattended cases?** Everything #612 originally described needs
   one, and this spec deliberately serves none of it. The real question is whether those cases are
   live wants or an artefact of a Laravel resource nobody documented. "No" closes #612 outright when
   this ships; "yes" is a second spec, a hardware purchase, and the tipping question coming back
   with it.
