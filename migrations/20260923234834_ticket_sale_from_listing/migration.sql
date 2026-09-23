-- The sale terms move off the announcement (#1203, phase 1).
--
-- Every listing with a term that differs from the old column defaults gets
-- one `ticket_sale` row; a listing without one reads as "not on sale, free,
-- floor of zero", which is what the defaults said. `group_id` stays null:
-- every sale so far is the collective's. The four `event_listing` columns
-- are left in place — the Worker still running during a deploy reads them —
-- and are dropped by a later migration.
--
-- The sale's id is the listing's, so a replay violates the primary key
-- rather than writing a second row.
INSERT INTO ticket_sale (
  id, event_listing_id, group_id, enabled, price_cents, price_floor_cents, quantity,
  created_at, updated_at
)
SELECT
  e.id,
  e.id,
  NULL,
  e.ticketing_enabled,
  e.ticket_price,
  e.ticket_price_floor_cents,
  e.ticket_quantity,
  e.created_at,
  e.updated_at
FROM event_listing e
WHERE e.ticketing_enabled = 1
  OR e.ticket_price IS NOT NULL
  OR e.ticket_price_floor_cents != 0
  OR e.ticket_quantity IS NOT NULL;
