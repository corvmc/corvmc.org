# NNNN Band music sells files, and the radio plays a timetable

- **Date:** 2026-09-03
- **Status:** Accepted
- **PRs:** #441, #1572, #1646

## Context

Bands upload records, sell them at a price they set, and can opt in to one station that plays
across the site. The collective takes a cut through Stripe Connect destination charges. CMC Radio
holds no performing-rights or webcast licence. Buyers often have no account.

## Decision

1. **CMC's 10% is a default the buyer can drag to zero.** The buyer names a total, at least the
   asking price, and divides it on a split bar. Card fees split in proportion to each side's take,
   so a zero share also carries a zero fee. "Cover processing" adds the fee on top, and neither side
   absorbs it. `application_fee_amount` is the charge minus the band's net, so the two always sum
   to the charge. One client-importable module, `audio-split.ts`, draws the bar and computes the fee.
2. **Audio lives in `R2_PRIVATE`, streamed by a Range-aware Worker route**, and is not in the
   `media` table. Cover art is ordinary public media.
3. **Streaming is free; the file is what is sold.** `draft` and `withheld` releases 404.
4. **The radio is a materialized timetable.** Cron writes `radio_play` rows ahead of the clock, and
   every listener hears the same thing. Responses carry the server's time so the client corrects
   for skew. `radio-rotation.ts` imports nothing, so the seed runs the real rotation rules.
5. **The radio plays only originals by members of no PRO**, attested per release to the current
   wording of `RADIO_PRO_ATTESTATION` and lapsing after a year. One predicate,
   `currentRadioAttestation`, answers for every view.
6. **Free releases never touch Stripe.** Prices between $0.01 and $2 are refused.
7. **The download token is the entitlement**, and the receipt that carries it is a mandatory
   notification.
8. **Connect events have their own webhook endpoint and secret.**

## Alternatives rejected

- **A fixed percentage.** A cut the buyer cannot refuse is a rake. The realised take is reported on
  `/staff/music`, net of fees, so the default can move on evidence.
- **Splitting fees evenly.** The collective would pay half the fee on a sale it took nothing from,
  and would need a floor to prevent it.
- **Public-bucket URLs for audio.** Edge-cached, but a download URL would be permanent and
  shareable.
- **Transcoding a stream copy.** Workers cannot run ffmpeg, and two uploads per track is friction.
- **A seeded shuffle for the radio.** No writes, but a band opting out would re-deal every
  listener's evening.
- **Verifying Connect events with `STRIPE_WEBHOOK_SECRET`.** Fails silently: `charges_enabled`
  never flips.

## Consequences

- The collective's realised share will not be 10%.
- A takedown sets `withheld` so the band cannot republish, and clearing a staff radio veto does not
  re-broadcast a release the band withdrew.
- Refunds are staff-only and whole-sale, which is why `stripePaymentIntentId` is stored.
