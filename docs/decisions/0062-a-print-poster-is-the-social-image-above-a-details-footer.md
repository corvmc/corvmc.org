# 0062 A print poster is the social image above a details footer

- **Date:** 2026-11-12
- **Status:** Accepted
- **Issue:** [#2609](https://github.com/corvmc/corvmc.org/issues/2609)

## Context

Events are promoted with a 4:5 or 1:1 social image, uploaded to the event's poster slot. The owner
asked for a footer that turns that image into a Letter poster carrying every detail of the event.
Letter is 0.77 wide to tall, so a 4:5 image at full width leaves almost no room below it.
[0061](0061-a-month-poster-is-a-printable-list-of-public-events.md) already prints the calendar
poster through Browser Rendering.

## Decision

1. **The source is the event's poster slot, when it holds an upload.** A generated flyer (alt
   text starting `Flyer for `, `FLYER_ALT_PREFIX` in `flyer-service.ts`) is refused, since it
   already carries the details. No poster, or a missing object, is refused the same way.
2. **One Letter page, 0.375 in margin, from one HTML template** (`src/lib/server/poster/event-letter.ts`),
   printed by Browser Rendering with backgrounds. Nothing is stored.
3. **The footer is at least 2.4 in (230 px).** The image keeps its ratio: full width when the
   footer still gets its minimum, otherwise scaled down and centred on cream. A 4:5 image prints
   603 x 754 px with a 230 px footer; a 1:1 image prints full width with a 240 px footer. A wider
   image gives a deeper footer.
4. **The footer carries** the title, the lineup (left out when it only repeats the title), the
   weekday, date, start and doors times, the venue and street address (the listing's own, else
   the venue's), the price in the flyer's wording, the sponsors the event page credits (logo, or
   name when there is none), a QR code to `/events/<id>` with `corvmc.org/events` printed under
   it, the mascot and the tri-stripe. A script in the page shrinks the type until the details fit.
5. **The download is a listing write** (`requireListingWriter`), the same check as the template
   flyer, through `printEventPoster` in `src/lib/remote/event-poster.remote.ts`.

## Alternatives rejected

- **Satori at 300 DPI.** The reasons in 0061 apply: a raster PDF, and a hand-measured fit.
- **Crop the image to fill Letter's ratio.** It cuts the artist's work, and social images often
  carry text near their edges.
- **Retire the satori "art with footer" flyer.** It is the social-size poster, and the publish gate
  reads it. It stays.

## Consequences

- `event_listing` has no age policy, so the footer prints none.
- Events have no slug or short link, and a UUID path cannot be typed off paper. The text under the
  QR code names the events page; only the code reaches the event itself. A short link would need a
  new route.
