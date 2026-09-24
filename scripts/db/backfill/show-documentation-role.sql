-- The `Show Documentation` role (#1500), at the id SHOW_DOCUMENTATION_ROLE_ID
-- names in src/lib/config.ts.
--
-- A member confirmed on an event's work order for this role may upload that
-- event's recap photos. The code keys on the id, never the name, so the id here
-- must match config exactly. Run with `wrangler d1 execute`.
--
-- Idempotent on the id and on the name, which is UNIQUE.

INSERT INTO volunteer_role (id, name, "group", description, display_order, is_active)
SELECT 'bd3734c3-fbbf-40bc-b277-886a8a01fd77',
       'Show Documentation',
       'at-shows',
       'Photograph a show for its recap. Staff confirming you on the shift lets you add photos to that show''s page.',
       45,
       1
WHERE NOT EXISTS (
  SELECT 1 FROM volunteer_role
  WHERE id = 'bd3734c3-fbbf-40bc-b277-886a8a01fd77' OR name = 'Show Documentation'
);
