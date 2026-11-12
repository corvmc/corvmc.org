# 0062 A print poster is the social image above a details footer

- **Date:** 2026-11-12
- **Status:** Accepted
- **Issue:** [#2609](https://github.com/corvmc/corvmc.org/issues/2609)

## Context

Events are promoted with a 4:5 or 1:1 social image, uploaded to the event's poster slot. The owner
asked for a footer that turns that image into a Letter poster carrying every detail of the event.
Letter is 0.77 wide to tall, so a 4:5 image at full width (8.5 x 10.625 in) leaves almost no room
below it.
[0061](0061-a-month-poster-is-a-printable-list-of-public-events.md) already prints the calendar
poster through Browser Rendering.

## Decision

1. **The source is the event's poster slot, when it holds an upload.** A generated flyer (alt
   text starting `Flyer for `, `FLYER_ALT_PREFIX` in `flyer-service.ts`) is refused, since it
   already carries the details. No poster, or a missing object, is refused the same way.
2. **One Letter page with no margin, from one HTML template**
   (`src/lib/server/poster/event-letter.ts`), printed by Browser Rendering with backgrounds.
   Nothing is stored.
3. **The art is full bleed; the footer is at least 1.5 in (144 px).** The art runs to the top
   and side edges in a box 8.5 in wide and at most 9.5 in tall, cropped to fill it
   (`object-fit: cover`, centred). A 4:5 image loses 10.6% of its height, 5.3% from the top and
   5.3% from the bottom. A 1:1 image prints 8.5 x 8.5 in uncropped, with a 2.5 in footer. An image
   that would lose more than 12% is fitted inside cream bands instead. The footer's background
   runs edge to edge; its contents stay 0.25 in inside the page.
4. **The footer carries** the title, the lineup (left out when it only repeats the title), the
   weekday, date, start and doors times, the venue and street address (the listing's own, else
   the venue's), the price in the flyer's wording, the sponsors the event page credits (logo, or
   name when there is none), a QR code to `/events/<id>` with `corvmc.org/events` printed under
   it, and the tri-stripe. A script in the page sizes the QR code to the footer and takes the
   largest type that fits, with the title on one line.
5. **The QR code carries the speaker cabinet** (the design system's favicon, without the sound
   lines) on a cream square at its centre. `posterQr` in `src/lib/server/poster/qr.ts` encodes at
   error correction H and clears at most 20% of the code's width, leaving the finder patterns
   whole. The calendar poster uses the same helper. Every test render decoded with jsQR at 20%.
6. **The download is a listing write** (`requireListingWriter`), the same check as the template
   flyer, through `printEventPoster` in `src/lib/remote/event-poster.remote.ts`.

## Alternatives rejected

- **Satori at 300 DPI.** The reasons in 0061 apply: a raster PDF, and a hand-measured fit.
- **Fit the whole image inside a margin.** The owner chose full bleed: the art is the poster, and
  a 4:5 image fitted whole leaves wide cream bands at its sides.
- **Retire the satori "art with footer" flyer.** It is the social-size poster, and the publish gate
  reads it. It stays.

## Consequences

- `event_listing` has no age policy, so the footer prints none.
- Events have no slug or short link, and a UUID path cannot be typed off paper. The text under the
  QR code names the events page; only the code reaches the event itself. A short link would need a
  new route.
