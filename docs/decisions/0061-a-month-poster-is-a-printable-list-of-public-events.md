# 0061 A month poster is a printable list of public events

- **Date:** 2026-11-12
- **Status:** Accepted
- **Issue:** [#2605](https://github.com/corvmc/corvmc.org/issues/2605), revising
  [#2597](https://github.com/corvmc/corvmc.org/issues/2597)

## Context

This replaces [0060](0060-a-month-poster-groups-by-who-made-the-event.md). The owner revised the
poster: public events only, one list in date order, CMC events told apart from member events, a QR
code to the website, and print at Letter and 11 x 17. `event_listing` has no visibility flag.
Committee sessions are stored as `kind = 'show'` on a committee-owned listing.

## Decision

1. **Public means published, not a meeting, and not owned by a committee.** Partner-feed imports
   are still left out. `monthCalendar` in `src/lib/server/poster/calendar-service.ts` holds the
   rule. Club sessions stay: they are open to the public.
2. **One list in date order.** Each row carries a marker: a filled teal square for a CMC event
   (`source = 'cmc'`), a red-orange ring for every other source. A legend names both. The shapes
   differ so the marks survive a black-and-white printer.
3. **A QR code links to `/events?from=<month>-01`**, the public events page opened at the month's
   first day. The address prints under it.
4. **Three formats:** Letter and Tabloid as one-page PDFs with a 0.375 in margin, and the
   1080 x 1350 PNG for social feeds.
5. **Cloudflare Browser Rendering lays out and prints the poster** from one HTML template
   (`src/lib/server/poster/calendar.ts`). A script in the page shrinks the type, then splits into
   two columns, then drops the last rows behind "+N more events". The same page gives the PDF,
   the social PNG and the staff preview.
6. **The footer credits every sponsor any listing on the poster credits**, as in 0060.

## Alternatives rejected

- **Satori for every size, with a PDF library or a 300 DPI PNG for print.** The satori layout
  needs a hand-measured fit for each aspect ratio. A 3300 x 5100 PNG is heavy for a Worker, and a
  PDF of it is a raster.
- **Keep satori for the social PNG.** That leaves two layouts of one poster to keep in step.
- **Mark sustaining members.** The owner asked for CMC against member only.

## Consequences

- The Worker needs the `BROWSER` binding, and Browser Rendering counts against the account's
  browser limits. A render reuses an idle session when one exists.
- A meeting stored with another `kind` on a band or club listing still prints.
- The mascot is a PNG, so it is the one raster on the PDF.
