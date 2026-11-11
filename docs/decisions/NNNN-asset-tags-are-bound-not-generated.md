# NNNN Asset tags are bound, not generated

- **Date:** 2026-08-27
- **Status:** Accepted
- **Issue:** PR [#286](https://github.com/corvmc/corvmc.org/pull/286)

## Context

Serialized gear needs a physical tag a phone can scan. Pre-printed, sequentially numbered
polyester QR tags cost about $0.15–0.30 each at quantity and survive gigging; a laser-printed paper
label does not. Consumables already carry a manufacturer UPC. Gear is entered before any tags
arrive, and tags come off.

## Decision

1. **The app binds a tag; it does not generate one.** `inventory_asset.assetTag` is nullable and
   unique. Staff scan a tag off the roll and bind it. An asset's identity is the row, so a lost tag
   is a rebind, not a renumber.
2. **Consumables are not tagged.** Their UPC goes in `inventory_item.gtin`.
3. **The QR encodes a plain `corvmc.org/a/{tag}` URL**, so a phone camera resolves it with no app.
4. **`/a/[tag]` is a server `load` that redirects** through `entityHref`: staff to the operational
   record, a member to the asset page, a signed-out viewer to sign in and back.

## Alternatives rejected

- **A `NOT NULL` tag.** Gear entered before the roll arrives would need placeholders, and
  placeholders in a unique column collide.
- **GS1 Digital Link.** Its syntax is keyed to GS1 identifiers behind a paid company prefix. The
  plain URL is the useful half.
- **A remote function for `/a/[tag]`.** A scan is navigation. A phone should get a 302 from the
  server, not a blank page that redirects after hydration.
- **Anodized aluminium tags** ($2–8 each). They are made for steam cleaning and submersion.

## Consequences

- `entityHref` carries an `asset` type with staff and member arms and no public arm. It is display
  logic, not authorization: the `load` builds the viewer from the real capability set, and asset
  queries guard in the remote layer.
- `parseScan()` tells a tag URL from a bare GTIN, since the two read different columns.
