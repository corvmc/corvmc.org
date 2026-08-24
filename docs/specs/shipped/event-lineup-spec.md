# Event lineup — who played vs. who manages

## Problem

An event carried exactly one band: `event.bandId`, written once at creation and
never editable afterwards. That single column was doing two unrelated jobs:

- **ownership** — whose panel the gig lives in, who may edit and publish it
- **attribution** — who actually played

Conflating them meant a bill with support acts could credit only one of them,
and a CMC-produced show that a member band played could not be credited to that
band at all.

Splitting them raises a question the old model never had to answer: if band A
can name band B on a bill, A can write to B's public profile. That is the
constraint this design is built around.

## Model

`event.bandId` stays, narrowed to **ownership**. It is the band whose panel the
gig lives in and the only band that can edit, publish, or cancel it. It is
`null` for CMC-produced events.

`event_band` is **the bill**. Every act, in `billingOrder` (0 = headliner).

A lineup row is **a name, optionally linked to a platform band**:

| Column          | Meaning                                                         |
| --------------- | --------------------------------------------------------------- |
| `name`          | Always set. This is what renders.                               |
| `bandId`        | Nullable. Set only when the credit points at a real `band` row. |
| `status`        | `unlinked` \| `pending` \| `confirmed` \| `declined`            |
| `billingOrder`  | 0 = headliner, ascending down the bill                          |
| `note`          | Optional slot label, e.g. "Direct support"                      |
| `addedByBandId` | Who put them on the bill                                        |

**Invariant:** `status = 'unlinked'` ⇔ `bandId IS NULL`.

**Invariant:** every write that sets `event.bandId` also writes the matching
`confirmed` lineup row, and `setEventLineup` never removes the owner's row.

### Why a name first and a link second

Most acts on a bill have no CMC account — overwhelmingly so in backfilled
history. If a credit required an account, the common case would be the one the
product couldn't express. So typing a name that matches nothing is the
frictionless path: it stores an `unlinked` credit, creates no account, notifies
nobody, and needs no consent machinery, because an unlinked credit touches
no one's profile.

## The consent rule

When a credit _does_ point at a platform band, it lands `pending` and the
reads split by direction:

| Surface                                                         | `unlinked` | `pending`  | `confirmed`           | `declined` |
| --------------------------------------------------------------- | ---------- | ---------- | --------------------- | ---------- |
| **The event** — public detail, owner's panel, owner's microsite | plain text | plain text | **links to the band** | plain text |
| **The named band's own profile / microsite / member shows**     | —          | **absent** | present               | **absent** |

The bill always reads accurately on the event, because it is the owner's
factual statement about their own show. But an unconfirmed credit never links
out and never reaches the named band's profile, so nobody can push traffic,
implied endorsement, or unwanted history onto a band that hasn't agreed.

In code this is the asymmetry between `getEventLineup` (returns everything) and
`confirmedForBand` / `confirmedForMember` (filter to `confirmed`). Those two
subqueries are the single definition of "shows on this band's profile" and are
covered by mutation-checked tests in `event-service.lineup.spec.ts`.

### Declining

Decline sets `declined` and keeps **both** the name and the `bandId`:

- the **name**, so the owner's record of their own bill stays accurate
- the **`bandId`**, so the partial `unique(event_id, band_id)` index blocks a
  re-invite

`setEventLineup` never resurrects a `declined` row. Without that rule an owner
could remove and re-add a band that said no and generate a fresh notification
every time.

Decline _is_ "remove me". There is no separate removal action.

## Permissions

| Action                                             | Who                                |
| -------------------------------------------------- | ---------------------------------- |
| Edit / publish / cancel the gig, upload its poster | The owning band's admins, or staff |
| Set the bill                                       | Same                               |
| Confirm or decline **your own** slot               | The named band's admins            |
| Link an `unlinked` credit to a real band           | Staff (`linkLineupSlot`)           |

A band on someone else's bill **cannot** edit or cancel the event.
`cancelBandEvent` deletes the poster from R2 — destructive and unauditable —
and two bands editing `startsAt` is last-writer-wins with no conflict UI.
Confirm/decline gives a support act control over the only thing it owns: its
own profile.

Band-side "claim this credit" — a band spotting its name as free text and
asking to be linked — is deliberately out of scope for now. Staff can do it.

## Consequences

- **Staff attribution falls out for free.** `setEventLineup` is source-agnostic
  and `event.bandId` stays `null` on CMC shows, so a venue-produced night can
  credit the bands that played. Since band-scoped reads follow the lineup, a
  CMC show a band confirmed on now appears on that band's profile. That is the
  point, not a side effect.
- **Bulk import never notifies.** `importBandEvents` writes support credits as
  `unlinked` unconditionally. A hundred-gig backfill must not fan out a hundred
  invitations, so linking is always a separate, deliberate act.
- **Unpublish notices reach the whole bill.** Everyone playing loses the date,
  not just the band that booked it.
- **Member show queries dedupe.** A member in two bands on one bill would
  otherwise be counted twice; with limit+1 paging a post-hoc dedupe would make
  `hasMore` lie, so both queries use a subquery rather than a join.
