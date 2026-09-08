# Stripe Connect Manual

Operating the band payouts behind music sales: what CMC became when it turned on Connect,
how a band gets paid, what breaks, and how to tell which thing broke.

For general Stripe operation (the platform API key, the platform webhook, `sync-webhooks`)
see [operations-manual §4](operations-manual.md#4-third-party-integrations). For creating
the Connect endpoint on a fresh environment see
[deployment-checklist §6a](deployment-checklist.md#6a-the-connect-endpoint--a-second-one-with-its-own-secret).
This manual is the day-to-day one.

> **Status: not yet exercised against real Stripe.** Everything below is built and unit
> tested; no onboarding, charge or refund has run against Stripe in any mode. The
> [Before you switch it on](#before-you-switch-it-on) checklist is the gate, and it is not
> optional — it is the only thing standing between this document and a band's money.

---

## 1. What CMC is now

Turning this on made the collective a **Stripe platform**, which is a change in posture
rather than a feature flag:

- **CMC is the merchant of record.** A buyer's card is charged by the collective. The band
  is paid by transfer, not by its own charge.
- **Money for a record never rests in the collective's balance** beyond the application
  fee. There is no float and no disbursement queue for staff to run.
- **Stripe handles the band's payouts, payout schedule and tax forms.** CMC never holds a
  band's bank details and deliberately does not mirror them —
  `createDashboardLink()` sends a band to Stripe's own dashboard instead.
- **CMC inherits connected-account disputes and Stripe's platform terms.** A chargeback on
  a record sale is the platform's problem first.

The trade for all that: **a band cannot sell until it finishes Stripe's onboarding.** Free
releases are exempt and need no Stripe account at all — that exemption is what lets a band
with no interest in paperwork still have a catalogue page and go out on the radio.

## 2. The shape of a sale

These are **destination charges**, not separate transfers:

```
payment_intent_data: {
  application_fee_amount: <what CMC keeps, INCLUDING Stripe's fee>,
  transfer_data: { destination: acct_… }
}
```

Stripe bills **the platform** for processing on a destination charge. That is the one fact
that makes the arithmetic non-obvious, and it is why `application_fee_amount` must already
include Stripe's cut — without that term CMC nets $0.41 on a $10 sale rather than $1.00.

`src/lib/finance/audio-split.ts` is the only thing that should produce that number. It is
the Connect-shaped adapter over `src/lib/finance/split.ts`, which is shared with ticketing.
A $10 sale at the suggested 10%:

|                             | Buyer pays | Band is transferred | Card processing | CMC keeps |
| --------------------------- | ---------: | ------------------: | --------------: | --------: |
| Buyer declines fee coverage |     $10.00 |               $8.47 |           $0.59 |     $0.94 |
| Buyer covers fees           |     $10.61 |               $9.00 |           $0.61 |     $1.00 |

Processing comes off the top before either side is paid, so both fund it in proportion to
what they take. A buyer who drags CMC's share to zero therefore leaves the collective with
**no share of the fee either** — refusing the cut costs CMC nothing rather than costing it
money. That property is why there is no minimum share to enforce.

Defaults live in `src/lib/config.ts`: `AUDIO_PLATFORM_FEE_BPS = 1000` (10%, the slider's
opening position, not a rake) and `AUDIO_MIN_PRICE_CENTS = 200` (a release is free or at
least $2 — below that Stripe's 30¢ eats most of it).

### Guards you will hit

`checkout()` refuses three combinations outright, all in
`src/lib/server/finance/payment-service.ts`:

| Refusal                                      | Why                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Credits + a destination account              | CMC credits are CMC's money; a coupon comes off the charge but not the application fee, so **the band would silently absorb the discount** |
| A destination account + `mode !== 'payment'` | Recurring transfers to a connected account are a different Stripe shape; nothing asks for one                                              |
| An application fee with no destination       | Meaningless, and a sign the caller built the options wrong                                                                                 |

## 3. How a band gets paid

1. A band admin opens `/band/<slug>/music/payouts` and presses **Set up payouts**.
2. `ensureAccount()` creates an Express account — `business_type: 'company'`, only the
   `transfers` capability requested, `metadata.corvmc_group_id` set. **It is idempotent by
   the `band_stripe_account` row**: coming back a week later returns the existing account
   rather than minting a second one. Abandoned onboarding is the common case.
3. `createOnboardingLink()` mints a **single-use, minutes-long** account link per click.
   Never store or reuse one. `refresh_url` points back at the flow, because that is where
   Stripe sends someone whose link went stale.
4. The band completes Stripe's hosted flow.
5. Stripe emits `account.updated` on the **connected-account** stream →
   `/api/stripe/connect-webhook` → `syncAccountFromStripe()` mirrors
   `charges_enabled`, `payouts_enabled`, `details_submitted` and `requirements.currently_due`
   onto the row.
6. `chargesEnabled` flipping to true is what makes a paid release publishable.

**Stripe is the source of truth for every one of those flags and the app never writes one
itself.** `syncAccountFromStripe` keys on the Stripe account id, not on our metadata,
because the id is the part Stripe guarantees. An account the platform holds that this
feature did not create is ignored and acknowledged — returning an error would make Stripe
retry it forever.

Only `chargesEnabled` gates selling. `payoutsEnabled` can lag while Stripe verifies a bank
account, and that is fine: the money accrues in the connected account and pays out when
Stripe is satisfied.

## 4. The Connect webhook is a second endpoint

This is the single most important operational fact in this document.

Connect events describe **connected accounts**, not the platform's own activity. Stripe
delivers them only to endpoints registered with `connect: true`, and **those are signed
with a different secret**. Verifying a Connect event against `STRIPE_WEBHOOK_SECRET` fails
every time.

```
/api/stripe/webhook          STRIPE_WEBHOOK_SECRET           platform events
/api/stripe/connect-webhook  STRIPE_CONNECT_WEBHOOK_SECRET   account.updated only
```

They are two routes rather than two branches of one handler specifically so that confusing
the secrets is impossible.

`scripts/sync-webhooks.ts` **does not manage the Connect endpoint** — it models one
platform endpoint and has no `connect` flag. Create it by hand, once:

```bash
stripe webhook_endpoints create \
  --url https://corvmc.org/api/stripe/connect-webhook \
  --enabled-events account.updated \
  --connect
```

```bash
wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET
```

**The failure is silent, and that is why it is written down twice.** Nothing errors when
the secret is wrong or the endpoint is missing. Bands complete onboarding, the column never
flips, and every attempt to publish a paid release is refused with a message about payouts
not being set up — which reads as a band problem, not an infrastructure one.

Verify by completing onboarding on a test band and **reading the column**, not by watching
for an error:

```bash
wrangler d1 execute corvmc --remote --command \
  "SELECT group_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted FROM band_stripe_account"
```

## 5. Before you switch it on

`bandAudio` and `cmcRadio` both default off. Before flipping `bandAudio` on
`/staff/settings`, run this in **Stripe test mode** — it is the pass nothing in CI can do
for you.

1. **Swap the key.** The local `.env` has historically carried a live `rk_live` key. Put a
   test key in place before touching any of this, or a QA click bills someone.
2. **Forward both webhook streams.** Two listeners, because there are two endpoints:
   ```bash
   stripe listen --forward-to localhost:5173/api/stripe/webhook
   ```
   ```bash
   stripe listen --forward-connect-to localhost:5173/api/stripe/connect-webhook
   ```
3. **Onboard a test band.** Complete Express onboarding with Stripe's test data, then
   confirm `band_stripe_account.charges_enabled` is `1`. If it is not, step 4 of the
   previous section is wrong — do not proceed.
4. **Publish a paid release** on that band and confirm it is offered for sale rather than
   showing the "hasn't finished setting up payouts" notice.
5. **Buy it** with `4242 4242 4242 4242`. Then check, in Stripe:
   - the connected account's balance rose by the band's share,
   - the platform's balance rose by `application_fee − stripe_fee`,
   - `release_purchase.status` is `paid` and its stored figures match what the buyer was
     shown on the split bar.
6. **Buy it again with fee coverage ticked** and confirm the band receives the full amount.
7. **Buy a free release** and confirm it never touches Stripe — no PaymentIntent, a `paid`
   row at $0, and a working download link.
8. **Refund the paid purchase** from _Recent sales_ on `/staff/music` and confirm the
   transfer reverses — the connected account's balance falls by the band's share, the
   platform's by its cut, and the buyer's download link stops working.

Only then turn `bandAudio` on. `cmcRadio` is a separate decision with a separate
prerequisite — enough uploaded music for a rotation to sound like a station, which
`/staff/music` reports as eligible tracks and distinct bands.

## 6. Refunds

There is a **Refund** button on each row of _Recent sales_ on `/staff/music`. It is
staff-only and deliberately not self-serve: a refund moves money out of a _band's_
account as well as the collective's, so somebody has to have read the request.

What it does, in one Stripe call:

```
stripe.refunds.create({
  payment_intent: pi_…,
  reverse_transfer: true,        // claw the band's share back
  refund_application_fee: true   // return the collective's cut
})
```

**Both flags matter.** Without them the collective refunds a buyer out of its own
pocket while the band keeps its share — a silent, one-directional loss that nothing
would have reported. This is why `release_purchase.stripe_payment_intent_id` is stored
alongside the Payment Record id: reversing a transfer is an operation on the charge, not
on the record that describes it. It is also why this is **not** the `refund()` the rest of
the finance module uses, which reports against a Payment Record and would leave the
transfer standing.

Things worth knowing before you press it:

- **The download stops working.** Every read of a download token is gated on
  `status = 'paid'`, so the flip revokes access with no extra step. Files the buyer
  already downloaded are theirs — that is not recoverable and never will be.
- **A band that has already been paid out goes negative.** Stripe takes the reversal out
  of the connected account's balance and, if it is short, recovers from the band's next
  sale. That is Stripe's behaviour and is deliberately not worked around: the alternative
  is CMC fronting the money and inventing a debt nothing tracks.
- **It is idempotent.** A second press is a no-op, not a second refund.
- **A free download can be revoked too.** Nothing was paid, so no money moves; the link
  simply stops working. The confirmation says so.
- **A paid row with no PaymentIntent is refused rather than revoked.** That combination is
  a lost webhook, not a free download, and flipping the status would take the buyer's
  files away while leaving their money with Stripe. Fix the webhook, then refund.

Partial refunds are not offered. Nothing in the buying flow can produce a partial sale,
and adding an amount field would mean reconciling three figures the split bar already
settled. For one, use the Stripe dashboard and set the row's status by hand.

## 7. Triage

| Symptom                                            | Likely cause                                  | Check                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Band finished onboarding, still cannot sell        | Connect webhook missing or wrong secret       | `charges_enabled` in `band_stripe_account`; Stripe → Developers → Webhooks → the `connect: true` endpoint's delivery attempts |
| "This band has not set up payouts yet"             | `ConnectNotConfiguredError` — no row at all   | Whether `ensureAccount` ever ran; the band may have bounced off the first screen                                              |
| Release page says the band hasn't finished payouts | `destinationFor()` returned null              | `charges_enabled` again — this is the same failure wearing a public face                                                      |
| Band sold but sees nothing in Stripe               | Looking at the platform dashboard, not theirs | Send them via **Open Stripe dashboard** on `/band/<slug>/music/payouts`                                                       |
| CMC's realised take is under 10%                   | Working as designed                           | `/staff/music` reports realised take; buyers can move the split, and free downloads dilute it                                 |
| Buyer charged, no `paid` row                       | Platform webhook, not Connect                 | `checkout.session.completed` deliveries on the **platform** endpoint                                                          |
| `account.updated` returns `handled: false`         | An account this feature did not create        | Expected for platform accounts from elsewhere; not an error                                                                   |

Sales figures across all bands are on `/staff/music`, which reports gross, to-bands, card
fees and CMC's net separately — they reconcile to the gross, and a regression test
(`staff-audio-service.spec.ts`) holds them to it.

## 8. Where the code is

| Concern                                     | File                                               |
| ------------------------------------------- | -------------------------------------------------- |
| Account lifecycle, status, sync             | `src/lib/server/audio/connect-service.ts`          |
| Connect webhook route                       | `src/routes/api/stripe/connect-webhook/+server.ts` |
| Destination-charge options and their guards | `src/lib/server/finance/payment-service.ts`        |
| The money split (Connect adapter)           | `src/lib/finance/audio-split.ts`                   |
| The shared split arithmetic                 | `src/lib/finance/split.ts`                         |
| Purchase rows, fulfilment                   | `src/lib/server/audio/purchase-service.ts`         |
| Guards on every band-facing call            | `src/lib/remote/audio.remote.ts`                   |
| Band-facing surface                         | `src/routes/band/[slug]/music/payouts/`            |
| Staff reporting                             | `src/routes/staff/music/`                          |

Rationale and the full design record: [band-audio-spec](../specs/shipped/band-audio-spec.md).
