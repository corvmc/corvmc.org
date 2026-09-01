# Product Config → KV Migration

Migrate the remaining `product_config` DB-table products
(`contribution`, `fee_coverage`, `ticket`, `band_premium`) to Cloudflare KV,
finishing the migration started for `rehearsal` (now `reservation.hourlyRateCents`).
KV becomes the single source of truth for product pricing/metadata.

## Strategy

Re-back `src/lib/server/finance/product-config-service.ts` with KV while keeping
its public API identical, so no consumers change. Each product is stored as a
JSON object under the `product-config:` KV prefix:
`{ stripeProductId, name, description, unitAmountCents, unitLabel }`.

`getStripeProductId` reuses an existing Stripe product tagged with
`metadata.corvmc_key` before creating a new one — this keeps Stripe product IDs
stable across an empty-KV cutover (subscription line items are matched by product
ID), so no data-port script is required.

## Checklist

- [x] Rewrite `product-config-service.ts` internals to use KV (`getJson`/`putJson`
      from `$lib/server/kv`); keep `ProductKey`, `ProductConfigRow`, `DEFAULTS`,
      and all exported function signatures unchanged.
- [x] `getStripeProductId`: look up existing Stripe product by `corvmc_key`
      metadata (via `stripe.products.list`) before creating; cache id back to KV.
- [x] Rewrite `product-config-service.spec.ts` to mock `$lib/server/kv` +
      `$lib/server/stripe` instead of `$lib/server/db`.
- [x] Remove DB schema: delete `src/lib/server/db/schema/product-config.ts`;
      remove its `export *` from `src/lib/server/db/schema/index.ts`.
- [x] Update `scripts/seed-dev.ts`: drop `productConfig` import, `seedProductConfig`
      function + its call, the `'product_config'` table-clear entry, and the
      "4 product configs" log line. (Products rely on DEFAULTS in dev, like the
      reservation rate.)
- [x] Verify: `pnpm run check` (0 errors), targeted specs green, full unit suite
      (636/638; the 2 failures are pre-existing flaky band specs that pass in
      isolation, unrelated to this change).
- [x] Drop the `product_config` table —
      `migrations/20260901200904_drop_orphan_product_config`. This one could not come from a
      plain `pnpm db:generate`: deleting the schema file also removed the table from the
      snapshot, and `generate` diffs the schema against the snapshot, so by the time anyone
      looked there was nothing left to diff. The table outlived its schema in every database
      for three months. It took `drizzle-kit generate --custom` to carry the `DROP`, and
      `scripts/migration-replay.spec.ts` now replays the migrations against the snapshot so a
      table can no longer go missing from both sides at once.

## Notes

- No consumer files change (subscription-service, band-subscription-service,
  payment-service, events.remote, membership.remote, settings.remote, staff
  settings page) — they all go through the unchanged service API.
- Any existing `product_config` rows in D1 become dead data once the schema is
  dropped; Stripe products are preserved via the metadata-reuse lookup.
