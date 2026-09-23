# Event poster — Spec

How a CMC show gets its poster: commissioned from an artist against a date, or, when nothing
arrives, a template flyer rendered from the event itself. Part of #852 (an event's publicity, end
to end). Covers #608 (commissioning) and #606 (compositing). #599 (a licensing library) is not in
it.

## The one mechanism

A poster is an **artifact request** pointed at an artist. `artifact_request` already carries
`poster_art`, a due date and a recipient `directory_entry`; what it lacks is anywhere for the art to
arrive, and anyone to send it to who is not on the bill. Everything below fills those two gaps and
adds the fallback that runs when the date passes.

```text
Art and Merch asks an artist ──► artist uploads on /act/{token} ──► staff promote it to the poster
        │ (due date)                     (attached to the request)        (as is, or with a footer)
        └── nothing by the due date ──► staff use the template flyer ──► poster slot filled
```

The event's `poster` slot on `media_attachment` stays the only thing that publishes. The #850
readiness gate reads that slot and does not change: a template flyer is a real poster, so an event
with no art is publishable exactly when Communications decides to run on the template.

## Phase 1 — commissioning (#608)

### Asking an artist

- The Advance tab's **Asked for** panel can address any directory entry, not only the bill. An
  artist is a member's entry or an external entry staff create in `/staff/bands`; neither is ever on
  `event_band`. The recipient control is a search over directory entries
  (`/api/directory/entries/search`, `event.manage`), alongside the existing bill list.
- The artist reaches the upload through the contact-sheet link staff already send
  (`SendContactSheetAction`). No new token, no new email.

### Delivering the art

- `/act/{token}` shows a **Poster art** card for each live `poster_art` request against that entry:
  the event's title, date, venue and bill, and the due date. That card is the info packet.
- Upload posts to `/api/acts/{token}/poster-art` with the request id. The route re-resolves the
  token and refuses a request that is not this entry's, or is cancelled. JPEG or PNG, 15 MB.
- The file is attached to the **request** — `attachableType: 'artifact_request'`, slot `poster` —
  never to the event. A token authorizes one entry's own record, and an event's public poster is
  not that. A re-upload replaces the previous one.
- The media row's caption records the credit: `Poster art by {entry name}`.

### Arrival and promotion

- `poster_art` reads **fulfilled** when its request has a `poster` attachment. Derived, like the
  rider and the press kit.
- The panel shows the delivered art as a thumbnail with **Use as poster**, which points the event's
  poster slot at the same media row (`attachExisting`). No copy of the object.
- What the artist is owed is a production expense in the `marketing` category, which already
  exists. Nothing new records it.

### Schema

- `'artifact_request'` added to `attachableTypes`, and to the media sweep's parent map so an
  attachment whose request is gone is reaped. A `text({ enum })` value, so no migration.

## Phase 2 — the flyer renderer (#606)

One function, `renderFlyer(event, art?)`, returns a 1080×1350 PNG.

- **No art:** the template flyer. Title, date, doors and start time, venue, the bill in billing
  order, and the ticket price or "free", on the brand palette.
- **With art:** the art fills the frame above a branded footer carrying the same details.

Rendering is `@cf-wasm/og` — satori to lay out, resvg to rasterize, built for workerd. Verified
under `wrangler dev` (38–102 ms per render) and through this repo's production bundle: Vite leaves
it external and wrangler resolves its `workerd` export with both wasm modules. It adds about
750 KiB gzipped to a Worker that was about 2.7 MB, against the paid plan's 10 MB.

- Fonts are passed as bytes, fetched from `static/fonts/` through `event.fetch`. The library's
  default fetches from Google Fonts at render time, which is a third-party dependency in a request
  path.
- Art is read at 1080 px wide through the zone's image transformations (`R2_TRANSFORM_URL`), so an
  artist's 15 MB original is never decoded inside the Worker.

### Where it is used

- The console's **Poster** card gains **Use the template flyer**, available whenever the event is
  not cancelled. It renders, uploads to `events/posters`, and replaces the slot.
- Delivered art in the **Asked for** panel gains **Use with a details footer** beside **Use as
  poster**. Compositing always starts from the artist's original, never from the current poster,
  so it cannot stack footers.
- A flyer is a snapshot. Changing the event's details does not re-render it; using the action again
  does.

Sponsor logos in the footer wait for #583, which has no sponsor record to read yet.

## Seed

- One upcoming CMC show with a live `poster_art` request against an external artist entry, no
  delivery, due in the past, so the overdue state and the template action are reachable.
- One with the art delivered and not yet promoted.

## Not in this spec

- **#599, a library artists upload to and musicians license from.** Licensing fees and a share of
  dues are a board decision about money, and there is no artist population until commissioning
  exists. The record of what each artist has made falls out of Phase 1: their fulfilled requests.
- A cutoff job that swaps in the template automatically. The due date is on the request and the
  overdue badge is on the console; running on the template is Communications' call.
- Image-rights terms. Agreed off-platform for now (#1407).
