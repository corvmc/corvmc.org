# Band audio and CMC Radio

Shipped across five phases on `feature/band-audio`. What survives here is the design
rationale — the options weighed and rejected — which is the half no manual article
carries. Live behaviour is in
[business-workflows.md](../../development/business-workflows.md#13-music-and-cmc-radio).

## What it is

Bands upload records, sell them at a price they set, and opt in to a single
synchronized station that plays across the site. Two feature flags gate it:
`bandAudio` for the storefront, `cmcRadio` for the station — the second exists
specifically so the radio can wait for enough bands to opt in.

## The decisions worth keeping

### Money: a refusable cut, not a rake

The collective's 10% is the **default position of a slider**. The buyer names a
total and divides it between the band and CMC on a Humble-Bundle-style bar, and
CMC's share can be dragged to zero.

**Card processing is shared in proportion to each side's take.** On a $10 sale at
the suggested 10%, the 59¢ fee splits 53¢/6¢ — the band nets $8.47 and the
collective $0.94.

Proportional rather than even, and the difference is not cosmetic: it is what
keeps the zero position safe. A buyer who allocates the collective nothing also
leaves it no share of the fee, so CMC nets exactly zero rather than paying to
sell somebody else's record — the cut stays refusable with no floor to enforce.
An even split would owe the collective half the fee on a sale it took nothing
from, and would need a floor to prevent it.

Ticking "cover processing" adds the fee on top of the total, and then neither
side absorbs any of it: both keep their whole allocation. That is the entire
point of the checkbox, and it is why the coverage surcharge is excluded from the
proportional apportionment rather than shared like the fee itself.

These are Connect **destination charges**, so Stripe bills the platform and
transfers the rest. `application_fee_amount` is therefore _whatever is left of
the charge once the band is paid_ — derived from the band's net rather than
computed independently, so band + application fee is exactly the charge and no
cent can fall between them.

The band's protection is the **total**, not a floor on its share of it: a buyer
must pay at least the asking price, and within that the allocation is free. That
distinction is easy to state backwards and was — the first split bar constrained
the band's _share_ to the minimum price, which consumed the whole amount and
clamped the collective's share to zero, so the suggested 10% never rendered.
`validateSplit` was right the whole time; only the component's prop was wrong,
which is why every unit test passed and a screenshot caught it.

Rejected: a fixed percentage. Transparency about where money goes reliably
raises what people pay, and a cut you cannot refuse is a rake. The trade
accepted knowingly is that the realised take will not be 10%; `/staff/music`
reports it net of fees so the default can be moved on evidence.

**One module, both sides.** `$lib/finance/audio-split.ts` is client-importable
because the same arithmetic renders the buyer's bar and produces Stripe's
application fee. Two implementations would eventually show one figure and pay
another.

### Storage: private bucket, Worker-streamed

Audio lives in `R2_PRIVATE` and is streamed through a Range-aware Worker route.

Rejected: the public bucket with direct `media.corvmc.org` URLs. Cheaper and
fully edge-cached, but the download URL would be permanent and shareable, and
`private-storage.ts` was split from `storage.ts` precisely so that a function
which publishes things (`getPublicUrl`, which cannot tell which bucket a key came
from) is never one autocomplete away from a private object.

**Audio is not in the `media` table** for that same reason, even though it would
inherit the sweep. Cover art, being an ordinary public image, is.

Rejected: transcoding a stream copy. Workers cannot run ffmpeg, and requiring
two uploads per track is friction bands will not absorb. One file, streamed and
sold.

### Free listening

Full tracks stream free to anyone; what is sold is the _file you keep_. Bandcamp's
bargain, and the one that gets local music heard — it is also what the radio
needs, since a station cannot ask every listener to log in.

The only paywall on streaming is **publication**: `draft` and `withheld` both 404,
because a takedown that still serves bytes is not a takedown.

### The radio is a materialized timetable

`radio_play` holds `(track, startsAt, endsAt)` rows written ahead of wall clock by
cron. Everyone tuned in hears the same thing.

Rejected: a deterministic seeded shuffle. It needs no writes, but the eligible
pool changes underneath it — a band opting out at 4pm would silently re-deal
every listener's evening, and two people comparing notes would find they had
never been hearing the same song. Rows already handed out do not move.

One table answers four questions: what is on, what is next, what just played, and
what has played least (the scheduler's own anti-repetition read).

**The client corrects for clock skew.** Every response carries the server's time;
without it a listener a minute fast starts every track a minute in, and "everybody
hears the same thing" would hold only for people with accurate clocks.

Two rules make the rotation sound like a station rather than a playlist, and
neither is visible in a query plan: never the same band twice running _when there
is an alternative_, and never the same song while something else is waiting. The
duration ceiling is load-bearing — a forty-minute live set would otherwise hold
the stream for forty minutes.

`radio-rotation.ts` imports **nothing**, which is what lets the dev seed reach the
real rules by relative path: the seed runs under plain tsx with no `$lib` alias
map. The alternative was a second copy of the programming rules drifting until
local data stopped behaving like production.

### Free releases are a first-class path

A free release never touches Stripe — its charge minimum is 50¢, so a $0 checkout
does not exist — and needs no connected account at all. That is what lets a band
with no bank details put a record out, be on the air, and still collect an email
address. Prices between $0.01 and $2 are refused: below that, card fees take
almost all of it.

### The download token is the entitlement

No session check, because a buyer with no account has nothing else. A full random
UUID, never listed, delivered by email so it survives the tab closing — which is
why the receipt is a **mandatory** notification type. Letting it be switched off
would let somebody opt out of receiving the thing they bought.

### Connect events need a second webhook endpoint

They are signed with a different secret. Verifying one against
`STRIPE_WEBHOOK_SECRET` fails every time, **silently**: nothing errors, bands
finish onboarding, `charges_enabled` never flips, and nobody can sell. Two
secrets, two routes. See
[deployment-checklist §6a](../../architecture/deployment-checklist.md).

### Staff tools are not behind the flag

`/staff/music` answers "is there enough music to switch the station on", and that
question cannot be answered from behind the toggle it gates. It reports eligible
**tracks** and distinct **bands** rather than releases, because a rotation of
forty tracks by two bands sounds like two bands.

A takedown sets `withheld`, not `draft`, so the band cannot simply press Publish
again — unpublishing your own work and having it unpublished for you are
different facts. The staff radio veto is kept distinct from the band's opt-in for
the mirror-image reason: clearing a veto must not re-broadcast something the band
withdrew in the meantime.

## Known gaps

- **The Connect path has never run against real Stripe.** Onboarding, a paid
  purchase and a refund all need a test-mode pass. Everything is covered by unit
  tests and guard specs, which is not the same thing.
- **No zip download** — per-track links only.
- **`cmcRadio` is not enabled in the e2e fixture.** The widget is fixed to the
  bottom of every page and turning it on across the suite would put it over
  controls other specs click. Covered by service and component specs instead; a
  real e2e wants a harness change.
- **Refunds are unbuilt.** A Connect refund needs `reverse_transfer` and
  `refund_application_fee`, which is why `stripePaymentIntentId` is stored
  alongside the Payment Record id — the plumbing is there, the surface is not.
