# Tap to Pay at the door

**Status:** 🔧 Building on `feature/tap-to-pay` (owner ruling, 2026-09-24). Android only, one
sideloaded handset, no app store. #522's payment gateway seam is on `main`. Phase 0 still needs the
owner's phone and a Stripe Location; see [Owner setup](#owner-setup).

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

## What changed when #522 landed

This spec was written while the gateway seam lived on `feature/in-house-checkout`. It is now on
`main`, and so are band ticketing (#1203, #1556) and the financial ledger (#1183). Reread against
them, seven decisions changed. The rest of the document has been updated to match.

1. **Terminal is not a third driver file.** `PaymentGateway` (`src/lib/server/finance/gateway/types.ts`)
   is `Pick`ed off Stripe's own SDK types, so the live driver _is_ the Stripe client and needs no
   code to gain a resource. Terminal is three port members instead:
   `terminal.connectionTokens.create`, `terminal.locations.retrieve` and `paymentIntents.create`.
   `fake-gateway.ts` implements them and `gateway.contract.spec.ts` sweeps both drivers.
2. **Door sales cover collective-sold shows only.** A band's gig (a `ticket_sale.groupId`) is a
   Connect destination charge into the band's own account. A card-present PaymentIntent can carry
   the same `transfer_data`, and the plugin's `connectReader` takes `onBehalfOf`, so this is
   reachable later, but whether CMC works a band's door at all is a product question: #1629. The
   door screen lists an event only when the collective sells it: a `cmc` listing with no
   `groupId`.
3. **No `ticket.paymentMethod` column, and so no migration.** `purchaseId` already records where a
   purchase came from (`comp-`, `rsvp-`, `free-`), and online purchases are bare UUIDs. A door
   purchase's id is its PaymentIntent id, so `pi_…` means "paid at the door by card", and a free
   door ticket is `door-<uuid>`. That answers "door or online" with no schema change, which also
   keeps the feature branch out of `main`'s migration lineage.
4. **The ledger is the settlement source.** #593 closed. `financial_entry` is what settlement and
   the weekly Stripe reconciliation read now. The door writer records the same rows an online
   collective ticket does (`ticket_sales`, `act_payout`, `card_fees`), keyed on the `purchaseId`,
   from the webhook.
5. **The connection token is a remote function, not a route.** `@capgo/capacitor-stripe-terminal`
   8.x, initialised with no `tokenProviderEndpoint`, emits `RequestedConnectionToken` and waits for
   `setConnectionToken({ token })`. The guarded remote mints it, so no public `+server.ts` is added.
   Old Open item 3 is settled.
6. **The capability is `finance.collect`.** It is new, granted to `admin` and `staff` (the matrix
   derives `staff`), and to no other position. Volunteers check tickets in today through a
   shift-scoped path with no capability (`checkInAsVolunteer`), so whether a rostered door
   volunteer may also take money is #1630. Old Open item 2 is settled pending that.
7. **Door rows have no attendee.** `ticket.attendeeName` and `attendeeEmail` are `NOT NULL`, so a
   door ticket is written as `'Door sale'` with an empty email, and no `ticket.purchased` receipt is
   sent. There is nobody to send it to.

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

**Not the `/checkout/[id]` Payment Element page.** It landed with #522, and it is still the wrong
place, because the Payment Element is **card-not-present**. A Terminal payment is card-present: its PaymentIntent is created with
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
ticket money would then split across two products in Stripe's own reporting, and settlement
would have to add them back together, forever. The distinction is not product but **method**, and
it is recorded where the repo already records provenance: the `purchaseId` prefix.

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
handset. _Which night_ is `paidAt`. _Which staffer_ is who was logged in, and `ticket.checkedInByUserId` already
records them — a column that exists, on a table that exists.

Nor would a device row buy control. A self-reported device identifier is an audit convenience: the
app reports whatever the app says, and a tampered handset reports a handset that has not been. The
real device gate is the one **Stripe already enforces** in `connectReader` — see [What the phone has
to be](#what-the-phone-has-to-be) — and it checks things an allowlist of ours could not, like
whether the bootloader is locked.

**So: no table, no column.** The door phone is **one CMC-owned handset, kept on site** (owner,
2026-09-25, #1632). The device is not modelled at all. The trigger to revisit is a _second_
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

**The phone's own NFC sensor is the reader.** No external hardware, no dongle, no Bluetooth
pairing — which the SDK's vocabulary actively obscures, so say it plainly: `discoverReaders()` and
`connectReader()` are discovering and connecting to **the handset itself**, and the Stripe Location
is a record of where that handset is rather than a device in its own right.

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

## Who can work the door

One item on that forbidden list deserves to be read as what it is rather than as a technical note.

**A running accessibility service blocks PIN collection.** PIN is required above the regional
contactless CVM limit. There is exactly one handset. Put those three together and the conclusion is
not about software: **a staffer who uses a screen reader cannot take a large door payment.** For a
nonprofit whose door is worked by whoever is around, that is a constraint on who can hold the shift,
and it should be written down in those terms rather than discovered by the person it excludes.

It is Stripe's constraint and not one we can engineer around on this device. What we can do is make
sure the device is never the only way to take money:

- **Keep a card-not-present path for large amounts.** A Stripe Payment Link on the show, opened on
  the buyer's own phone, needs no reader and no accessibility compromise. Once #522 lands, the
  in-house checkout is the better version of the same escape hatch.
- **The door screen should offer it as a normal choice, not a fallback for failures** — a "send a
  link instead" affordance next to the tap, always present. A path that only appears after an error
  is a path that is only found under pressure.
- Two qualifying handsets would also solve it, and are the same answer as [Open](#open) item 4.

The rest of the forbidden list is configuration a person can change. This one is not, and
architecting around it is cheap only if it is done now.

### The second path covers three cases, not one

That card-not-present path is not only the accessibility answer, and it is worth listing what it
serves so nobody later treats it as a single-purpose escape hatch and prunes it.

Tap to Pay is **contactless only**. The phone's NFC is the whole reader, so there is no slot to
insert a card into and **swiping is not allowed at all**. A customer holding a magstripe-only or
chip-only card, or a contactless card whose antenna has died, cannot pay at the door — not as a
degraded experience, but at all.

So the door screen's second way to take money covers three situations that look identical from the
outside and are not:

1. **A staffer who uses a screen reader**, where a running accessibility service blocks PIN
   collection above the contactless limit.
2. **A card that cannot tap** — magstripe-only, chip-only, or a dead antenna. No swipe, no insert,
   no exceptions.
3. **A tap that failed on a card that should have worked.**

**Only the third is a retry.** The first two are not, and presenting either as a decline tells the
customer their card was refused when it was never read — which is the same failure the
`TAP_TO_PAY_INSECURE_ENVIRONMENT` handling above exists to avoid, arriving by a different route. It
is the strongest argument for the affordance being always present rather than appearing after an
error: in two of three cases there is no error to appear after.

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

The schema question reduces to one thing: where a door payment gets recorded. The answer this spec
lands on is **no new column and no new table**, which is not where it started. The options are
walked below because the obvious one is wrong for a reason worth writing down.

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

**(c) A separate `terminal_payment` table.** Its own row per card-present take, with the operator on
it. Solves the problem cleanly and is the obvious answer.

**(d) Add nothing. `ticket` already carries a door sale.** Not obvious, and correct.

**Recommend (d),** and the reason is not that it is less code.

**It is the only option that adds no new source to settlement.** Ticket revenue is read from
`ticket` and the `financial_entry` rows keyed on its `purchaseId`. A door ticket paid by tap writes
a `ticket` row with `stripePaymentRecordId` set, plus the same ledger rows an online sale writes,
which are sources settlement **already** reads. Option (c)
takes settlement to three sources permanently; option (b) takes it to two with a filter that has to
be remembered in every place a member count or an audience is derived; (a) takes it to two, one of
which silently drops the rows in question. Only (d) leaves settlement at exactly the two sources it
planned for.

Everything a door ticket needs is already on the row, and every one of these columns exists on
`main` today:

| Question              | Column                                                           |
| --------------------- | ---------------------------------------------------------------- |
| Who bought it         | `userId`, **nullable**, `onDelete: 'set null'` — no account fine |
| What they paid        | `unitPriceCents`, plus the split columns the scale writes        |
| Proof of payment      | `stripePaymentRecordId`, nullable `text` — holds the `pi_…`      |
| Which staffer took it | `checkedInByUserId` — see below                                  |
| When                  | `checkedInAt`, `createdAt`                                       |
| Which order           | `purchaseId`, `NOT NULL text`, no FK, `idx_ticket_purchase`      |

`checkedInByUserId` answers the operator question for free, and only because of a fact about the
door specifically: **a door ticket is checked in at the moment it is minted**, because the person is
already walking in. Seller and check-in-er are the same staffer in the same gesture. That is a real
coincidence of the surface rather than a column doing double duty, and it is worth saying out loud
so nobody later assumes it generalises to donations.

**No column is needed either.** An earlier draft added `ticket.paymentMethod`, reasoning that a
`pi_` in `stripePaymentRecordId` cannot tell a door sale from an online one. That is true of
`stripePaymentRecordId`, but not of `purchaseId`. Online purchases are bare UUIDs, and the
repo already marks non-checkout purchases by prefix (`comp-`, `rsvp-`, `free-`). A door purchase's
id is its PaymentIntent id, `pi_…`, and a free door ticket is `door-<uuid>`. So "door or online"
is a prefix test on a column that exists. The ledger rows the door writes also say
`'Door, card present'` in their description.

### Why not (c), stated as the repo states it

`inventory-spec.md:589` declined a `supplier` table and said to revisit it "when free text actually
fragments, or when one of those features forces the entity into being" —
and `contractor-work-spec.md` is the record of servicing eventually forcing it, years of free text
later. That is the pattern to follow here.

The thing that would force a payment table is **donations** (phase 4): they have no ticket row to
hang off, no `purchaseId`, and no check-in gesture to supply an operator. When that surface is
designed, it will need somewhere to put a payment, and `terminal_payment` as sketched under (c) is
probably what it should be. **It gets built then, with that surface's requirements in hand, and not
before.** Building it now means designing a table against a use case nobody has written down, which
is how you get columns that are wrong in ways only the second caller discovers.

### Where a card-present refund is recorded

This is the one column (c) was buying for tickets — `refundedAt` — so (d) owes it an answer.

The answer is that it does not need a local column, because **Stripe already is the guard.**
`refundPaymentIntent` in `payment-service.ts` retrieves the intent with `expand: ['latest_charge']`
and computes `outstanding = amount_captured - amount_refunded`, refunding only when that is
positive. That charge-level check is complete and race-free on its own; the `payment_cache` lookup
at the top of `refund()` is a round-trip optimisation, not the thing that makes it safe. A door
ticket with no `payment_cache` row falls through to the `pi_` branch and is guarded correctly, and
the trailing `UPDATE payment_cache … WHERE id = ?` matches zero rows, which is the right outcome
rather than an error.

Locally, the refund is recorded as the ticket being **cancelled** — the existing terminal state,
which is what settlement needs, since a cancelled ticket is excluded from revenue either way.

The honest cost: "was this ticket refunded, or comped and cancelled?" is not answerable from D1
without asking Stripe. That is acceptable here and it is the position `reporting-spec.md` already
takes about which vendor answers which question — Stripe is the payment ledger, and "how much did we
refund at the door last month" is a Stripe question. It would stop being acceptable the moment
somebody wants that number on a CMC page, which is a second thing that would force the table.

### Status moves

A ticket's status moves by atomic conditional update with a row-count check, never read-then-write:

```sql
UPDATE ticket
   SET status = 'cancelled', updated_at = ?
 WHERE id = ? AND status IN ('valid', 'checked_in')
```

Zero rows affected means somebody already cancelled it — return without calling Stripe. This is
`refund()`'s local guard tightened: that one does a `SELECT` and then an `UPDATE`, which is a race
under concurrency. `db.transaction()` is unavailable on D1 and `db.batch([...])` gives no
read-your-write inside the batch, so the condition has to live in the `WHERE` clause. The D1
constraint produces the better design here rather than a worse one.

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

### The thin shell is what makes sideloading tolerable

These two decisions look like they are in tension and are not. Sideloading makes every reinstall a
physical trip to the phone, Developer options toggled twice, a reboot and a manual test payment —
and the phone cannot be updated during an event. That would be a serious ongoing cost for a normal
app.

**It is not a cost here, because a thin shell almost never needs reinstalling.** Everything that
changes — the door screen, the sliding-scale controls, the pricing, the copy, every fix — is web
content served from corvmc.org and reaches the phone on the next page load, exactly like the rest of
the site. The native binary changes only when the Capacitor or Terminal SDK versions do. The thin
shell is the **mitigation** for the sideload burden, not a casualty of it, and that is the second
independent argument for `server.url` after the security-boundary one.

The residual is real and points the same direction: **there is no store-update path underneath, so
the native shell has to be close to right on first install.** A bug in the bridge is a trip to the
phone; a bug in the web app is a deploy. That is a design constraint, not just a risk — **keep the
native surface as small as it can possibly be.** Nothing in the shell but the Terminal bridge and
the tap-screen configuration. Any logic that could live on either side lives on the web side.

_(For the record, the alternative once considered was a second `adapter-static` SPA target built
from this repo. It is not recommended: it would put the app on a different origin, forcing CORS on
`/_app/remote/*` and `SameSite=None` on the session cookie, and remote function URLs carry a module
hash, so a phone that had not updated could not call a redeployed server. It is written down only so
nobody re-derives it.)_

### The connection token

`initialize()` takes a connection-token source. The token is a bearer for the Stripe account, so who
may mint one is a capability question, not a configuration question.

**Settled: a guarded remote `command`.** The webview calls it, it checks `finance.collect`, and it
returns a secret scoped to the configured Location. The JS then passes that secret to the plugin
with `setConnectionToken`. This works because the plugin's `TokenProvider.kt`, when `initialize()`
is given no `tokenProviderEndpoint`, fires `RequestedConnectionToken` and waits. The boundary stays
where the repo puts it, and no public route exists.

The rejected alternative was a `+server.ts` endpoint fetched by the native side. **A native HTTP
client does not share the webview's cookie jar**, so that endpoint could not be guarded by the
session at all.

A connection token is short-lived and single-use, so it is never cached on the server or stored in
the page. The SDK asks again when it needs one.

### Where the code goes

- The Capacitor project is a new top-level directory, and `scripts/coverage.spec.ts` fails on any
  source file that no tsconfig project compiles. It must be added to `tsconfig.tooling.json` in the
  same PR that creates it.
- **Terminal is port members, not a driver.** `terminal.connectionTokens.create`,
  `terminal.locations.retrieve`, and `paymentIntents.create` / `cancel` are added to
  `PaymentGateway`. The fake implements them, and the live driver gets them from the SDK for free.
  `PAYMENTS_DRIVER` defaults to `fake`, so no environment but production ever reaches Stripe.
- **The Location is configuration:** `STRIPE_TERMINAL_LOCATION_ID`, a `tml_…` id, read server-side
  and handed to the app alongside the token. No Location set means the door screen says so and
  offers the card-not-present path. It does not guess.
- The door screen is a `<domain>/` component folder — it imports remote functions, so it cannot live
  in `ui/`. Forms use `$lib/components/ui/Form/`. No gradients.

## What it sells

**First: door tickets.** The money already has a model (`ticket`, `purchaseId`, `unitPriceCents` and
the split columns), the sliding-scale UI is being built anyway, the surface it belongs beside
already exists, and **settlement needs it** — door revenue is precisely the number the settlement
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

A card-present payment is a `pi_…` PaymentIntent, and `refund()` already branches on that prefix. It
needs no new Stripe-side work at all: the charge-level `amount_captured - amount_refunded` check is
the guard, as set out under [Where a card-present refund is
recorded](#where-a-card-present-refund-is-recorded). What the Terminal path adds is the local half —
moving the ticket to `cancelled` in the atomic conditional form given under [Status
moves](#status-moves).

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

**`purchaseId` is the PaymentIntent id.** That one decision does most of the work below: it makes
"have we already minted for this tap" a lookup on an index that exists (`idx_ticket_purchase`), and
it makes the sweep's match trivial. `purchaseId` is a bare `text` with no FK, so nothing objects.

**Two things happen at a tap, and conflating them is the mistake to avoid.** The _admission
decision_ — paid, let them in — and the _ticket record_ are not the same event and do not need the
same latency.

1. `collectPaymentMethod()` then `confirmPaymentIntent()` on the device. **The SDK returns the
   confirmed PaymentIntent synchronously**: a successful tap returns a success indication and
   control returns to the app. That return is the merchant's proof of payment, and it is what the
   door screen shows. **Admission is settled here, with no webhook involved** — a staffer is
   physically present and admission is their judgement, not a scan.
2. **Rows are minted `pending` when the PaymentIntent is created**, under
   `purchaseId = <the pi_… id>`. This is the online flow's shape (`createTickets` then
   `fulfillPurchase`), and it holds the seats while the card is being tapped.
3. Stripe's **`payment_intent.succeeded` webhook is the only thing that flips them.** It runs one
   conditional `UPDATE … WHERE purchase_id = ? AND status = 'pending'` to `checked_in`, setting
   `stripePaymentRecordId`, `checkedInAt`, and `checkedInByUserId` from the intent's metadata. A
   redelivered event matches zero rows and writes nothing, so it is idempotent without a lookup. The
   ledger rows are written only when that update returned rows.
4. The webview then calls a guarded remote `query` with the PaymentIntent id. **It is a read, not a
   second writer.** It returns the tickets for that `purchaseId` once they are checked in. The app
   is never trusted to tell the server that a payment succeeded. It only asks whether the record has
   landed.
5. An abandoned tap leaves `pending` rows, which the existing `cancelStalePendingTickets` sweep
   already cancels. A cancel on the door screen cancels the intent and the rows at once.

**One writer is right, not a compromise.** Letting the app write too would put two writers on rows
sharing a `purchaseId` with nothing to conflict on: D1 gives no read-your-write inside a `batch`,
and `ticket.code` is unique but randomly generated, so there is no natural key for a dedupe to hang
off. Sole-writer removes that problem rather than guarding it, and it costs nothing at the door
because step 1 already answered the only question anyone is standing there waiting on.

Webhook latency would only bite if the door had to put a scannable code in the customer's hand at
the moment of payment. It does not — that is what the online purchase flow is for.

**This is a solved problem, not a new one.** #522 established exactly this pattern across four
landing pages: once the buyer paid on our own page rather than being redirected back, they arrived
in the same second they confirmed and would have read unpaid codes, so each page polls its own query
on a bounded retry keyed on the fact that the webhook writes. The
`(public)/events/[id]/tickets/success` page carries the reasoning in a comment and a
`RETRY_LIMIT` / `RETRY_MS` pair. The door screen is the fifth instance and should reuse the shape
rather than invent one.

A periodic sweep is still the backstop: list card-present PaymentIntents for the Location since the
last run, match against `ticket.purchaseId`, and surface unmatched ones on a staff screen for a
human to attach or refund. Webhooks are delivered, not guaranteed.

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
- **Reconciliation**: the webhook writer, its re-run behaviour on a redelivered event, the sweep's
  match on `ticket.purchaseId`, and the settlement read across `ticket` + `payment_cache`.
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

All of this lands on `feature/tap-to-pay`, one squash-merged PR per phase. `main` sees it once, in
a landing PR that waits on the owner's phone (see [Owner setup](#owner-setup)). The owner started
the build on 2026-09-24 without waiting for phase 0, since phases 1 to 3 need no phone.

**Phase 0: the assumption test, on the owner's phone.** Install the phase 3 debug build, disable
Developer options, and call `connectReader` against the simulated reader. If that succeeds,
sideloading works and the plan holds. If it fails, [Open](#open) item 1 has been answered the hard
way, and the landing PR does not open. **This gates the landing PR, not the branch.**

**Phase 1: gateway and token.** The Terminal port members plus the fake, `finance.collect`, the
Location config, and the guarded connection-token remote. Everything here can be automated.

**Phase 2: the door screen.** Pick a collective-sold event, choose a quantity and a price per
ticket, then take the payment. The screen shows the tickets remaining and warns, without refusing,
when a sale goes past capacity (#1631). Rows are minted `pending` on intent creation and flipped to
`checked_in` by the `payment_intent.succeeded` handler, which also writes the ledger rows. Free
and below-minimum sales mint `checked_in` at once. A browser without the plugin gets the same
screen with the tap disabled and the card-not-present path offered. Extend `scripts/seed-dev.ts`,
and add the row to `docs/reports/feature-catalog.md`.

**Phase 3: the Android shell.** The Capacitor project in its own top-level directory, with
`server.url`, the plugin, `setTapToPayUxConfiguration` in the CMC palette, and the build and
sideload procedure in `docs/development/`.

**Later: the reconciliation sweep, then donations.** The sweep lists card-present intents for the
Location and flags any with no `checked_in` rows. It is worth building only once real traffic
exists. Donations remain the cheapest second surface.

## Owner setup

CI cannot hold a phone, so nothing below can be automated. The landing PR opens only when all of
it is done.

**Stripe Dashboard, in test mode first and then live:**

1. Confirm Terminal is enabled on the account (Dashboard, More, Terminal). Tap to Pay on Android
   needs no separate application in the US.
2. Create a **Location** with CMC's street address and the display name "Corvallis Music
   Collective". Copy its `tml_…` id.
3. Add `payment_intent.succeeded` to the webhook endpoint's events (`scripts/sync-webhooks.ts`
   reads `webhook-events.ts`, so running it does this).
4. Confirm the card-present rate on the account's pricing page against the constants in
   `src/lib/finance/fees.ts`.

**Worker secrets:** `STRIPE_TERMINAL_LOCATION_ID` for test and for production. The existing
`STRIPE_SECRET_KEY` mints the tokens, so no new key is needed. Never use the live key before
phase 0 has passed in test mode.

**The phone:** Android 13 or later, not rooted, bootloader locked, stock OS, a security patch less
than 12 months old, Google Play Store installed, NFC on, and a screen lock set. See
[the checklist](#what-the-phone-has-to-be).

**Sideload, every install:** enable Developer options and USB debugging, run
`adb install -r app-debug.apk`, **disable Developer options**, reboot, sign in to corvmc.org in the
app, and take one simulated test payment before the doors open.

## Deliberately out

- **The unattended kiosk** — check-in, door access, a walk-up booking screen. All three are things a
  device does while nobody is holding it, and the reader disconnects the moment the app backgrounds.
  A hardware conclusion, not a scope preference, and the single most important thing this spec
  settles. Those cases need a smart reader (S700 / WisePOS E), specced separately as #1659.
- **A device registry.** See [above](#there-is-no-device-registry). One phone, one Location, one
  operator: no table and no column.
- **A payments table.** No `terminal_payment`, no row per card-present take. `ticket` already carries
  a door sale, and adding a table would take settlement from the two sources it was designed
  for to three. Donations are what would force one; they get it when they are designed.
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
2. **Who may take a payment.** Settled for the build as `finance.collect`, held by `admin` and
   `staff`. Whether rostered door volunteers get it is #1630.
3. **Can the plugin be handed a token directly?** Settled: yes, through `setConnectionToken`. See
   [The connection token](#the-connection-token).
4. **Whose phone is it, and is there a backup?** Settled by #1632 (owner, 2026-09-25): one
   CMC-owned phone, kept on site, and no device table. A second handset is the trigger to revisit;
   see [There is no device registry](#there-is-no-device-registry).
5. **Door sales for band-sold gigs.** #1629. Until it is answered, only collective-sold shows are
   offered.
6. **Does a door sale count against capacity?** Settled by #1631 (owner, 2026-09-25): it counts,
   and it only warns. The door screen shows the tickets remaining under `ticket_sale.quantity`;
   past zero it warns "over capacity by N" and still takes the sale, because the person at the door
   decides. There is no separate door allocation and no schema change.
7. **Does CMC want an S700 for the unattended cases?** Settled by #1632 (owner, 2026-09-25): yes,
   later. A smart reader for check-in, door access and walk-up booking is its own spec and a later
   hardware purchase, #1659. It does not block this one, and #612 closes when the landing PR merges.
