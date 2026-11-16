# 0010 Poster art is an artifact request

- **Date:** 2026-09-23
- **Status:** Accepted
- **Issue:** [#852](https://github.com/corvmc/corvmc.org/issues/852)

## Context

A CMC show's poster was whatever a staffer uploaded. Commissioning an artist (#608) and falling back
to a generated flyer (#606) both needed a home. `artifact_request` already carried `poster_art`, a
due date and a recipient directory entry, but had nowhere for the art to arrive.

## Decision

1. **A commission is an artifact request** pointed at any directory entry, not only an act on the
   bill. The artist uploads through the contact-sheet link staff already send, on `/act/{token}`.
2. **Delivered art attaches to the request,** never to the event. A token authorises one entry's
   own record, and the event's public poster is not that. A request with art reads as fulfilled.
3. **"Use as poster" points the event's poster slot at the same media row,** with no copy.
4. **The template flyer** is one function, `renderFlyer`, producing a 1080×1350 PNG with or without
   art, on `@cf-wasm/og` (satori and resvg, built for workerd). Fonts and the mark are bundled so a
   render makes no network request. Art is read through the R2 binding.
5. **A flyer is a snapshot.** Editing the event does not re-render it; running the action again
   does. Compositing starts from the artist's original, so footers cannot stack.
6. **The event's poster slot is the only thing that publishes,** so a template flyer satisfies the
   readiness gate like any poster.

## Alternatives rejected

- **Cloudflare image transformations to read the art.** `format=auto` can answer AVIF, which resvg
  cannot decode.
- **A cutoff job that swaps in the template when the due date passes.** Running on the template is
  the Communications committee's call.
- **A licensing library for artists' work (#599).** Licensing fees are a board decision about money,
  and there is no artist population until commissioning exists.

## Consequences

- The Worker grew by about 850 KiB gzipped for the renderer.
- What an artist is owed is a production expense in the `marketing` category.
