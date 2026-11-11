# 0005 Lineup credits need the band's consent

- **Date:** 2026-08-12
- **Status:** Accepted

## Context

An event carried one band, `event.bandId`, written once at creation. That column did two jobs:
**ownership** (whose panel the gig lives in, who may edit it) and **attribution** (who played). A
bill with support acts could credit only one of them, and a CMC show could not credit the member
band that played it. Splitting the two jobs meant one band could name another on a bill, and so
write to that band's public profile.

## Decision

1. **`event.bandId` is ownership only.** It is null on a CMC show.
2. **`event_band` is the bill:** a row per act in `billingOrder`, each a name optionally linked to
   a platform band. `status = 'unlinked'` exactly when `bandId` is null.
3. **A name first, a link second.** Typing a name that matches nothing stores an `unlinked` credit,
   creates no account and notifies nobody, because it touches no one's profile.
4. **A linked credit lands `pending`.** The event shows every credit as written, but only a
   `confirmed` credit links to the band, and only a confirmed one appears on the band's own
   profile, microsite or member shows. One filter on `confirmed` defines "shows on this band's
   profile".
5. **Declining keeps the name and the `bandId`.** The owner's bill stays accurate, and the partial
   unique index on `(event_id, band_id)` blocks a re-invite. `setEventLineup` never resurrects a
   declined row. Declining is how a band removes itself.
6. **Only the owner edits the event.** A band on someone else's bill can confirm or decline its
   own slot, nothing more. Staff link an unlinked credit to a real band.

## Alternatives rejected

- **Requiring an account for every credit.** Most acts on a bill have no CMC account, so the
  common case would be the one the product could not express.
- **Letting a credited band edit or cancel the gig.** Cancelling deletes the poster, and two bands
  editing `startsAt` is last writer wins with no conflict UI.
- **A band-side "claim this credit" request.** Left out; staff link credits.

## Consequences

- A CMC show a band confirmed on appears on that band's profile.
- `importBandEvents` writes support credits as `unlinked`, so a backfill sends no invitations.
- Unpublish notices go to every band on the bill.
- Member show queries use a subquery rather than a join, so a member in two bands on one bill is
  counted once and limit+1 paging stays correct.
