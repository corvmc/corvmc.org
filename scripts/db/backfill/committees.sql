-- The six committees, headless.
--
-- Written as SQL rather than through `/staff/groups` because the same six rows
-- have to land identically and a form filled in six times does not guarantee
-- that. It replicates `createGroup`'s batch exactly, minus the owner row:
-- the `group`, its `directory_entry`, and nothing else. `band_site` is bands
-- only and the owner row is what "headless" means -- `assignLeader` fills the
-- seat when the board appoints a chair.
--
-- Idempotent on the slug, so a re-run writes nothing.
--
-- The bios are the org's own words, lifted from the `volunteer_role` rows that
-- have described these committees on /contribute since before the groups
-- module existed. Those roles retire once their interest is migrated.

INSERT INTO "group" (id, kind, name, slug, bio, join_policy)
SELECT '1edcf908-a51f-480f-9a28-8f872c264e2f', 'committee', 'Booking Committee', 'booking-committee', 'Approve programs and book bills for CMC produced events.', 'invite_only'
WHERE NOT EXISTS (SELECT 1 FROM "group" WHERE slug = 'booking-committee');

INSERT INTO directory_entry (id, group_id, name, bio, visibility)
SELECT 'd363ffd9-617e-44bc-8221-873f7a284b6b', g.id, g.name, g.bio, 'public'
FROM "group" g
WHERE g.slug = 'booking-committee'
  AND NOT EXISTS (SELECT 1 FROM directory_entry d WHERE d.group_id = g.id);

INSERT INTO "group" (id, kind, name, slug, bio, join_policy)
SELECT 'ce68e733-bae3-4153-8e14-ae4985debc61', 'committee', 'Production Committee', 'production-committee', 'Operate, staff, and run CMC produced events.', 'invite_only'
WHERE NOT EXISTS (SELECT 1 FROM "group" WHERE slug = 'production-committee');

INSERT INTO directory_entry (id, group_id, name, bio, visibility)
SELECT '48a83117-ab02-4c23-b9c9-92dc0b48fc29', g.id, g.name, g.bio, 'public'
FROM "group" g
WHERE g.slug = 'production-committee'
  AND NOT EXISTS (SELECT 1 FROM directory_entry d WHERE d.group_id = g.id);

INSERT INTO "group" (id, kind, name, slug, bio, join_policy)
SELECT 'e95a832d-cf6c-4fd9-8570-e08868c1a691', 'committee', 'Development Committee', 'development-committee', 'Raise funds, reach out to potential sponsors, and improve and deliver membership benefits.', 'invite_only'
WHERE NOT EXISTS (SELECT 1 FROM "group" WHERE slug = 'development-committee');

INSERT INTO directory_entry (id, group_id, name, bio, visibility)
SELECT '00f4dede-7b7a-43e6-b88d-350eb5cc328c', g.id, g.name, g.bio, 'public'
FROM "group" g
WHERE g.slug = 'development-committee'
  AND NOT EXISTS (SELECT 1 FROM directory_entry d WHERE d.group_id = g.id);

INSERT INTO "group" (id, kind, name, slug, bio, join_policy)
SELECT '5219ff1e-c568-4f99-a663-7f413c3b71dc', 'committee', 'Communications Committee', 'communications-committee', 'Coordinate show posters, announce on social media and with local press. Write and deliver the newsletter.', 'invite_only'
WHERE NOT EXISTS (SELECT 1 FROM "group" WHERE slug = 'communications-committee');

INSERT INTO directory_entry (id, group_id, name, bio, visibility)
SELECT '2aec34a7-f333-4282-a5e0-a463b583190d', g.id, g.name, g.bio, 'public'
FROM "group" g
WHERE g.slug = 'communications-committee'
  AND NOT EXISTS (SELECT 1 FROM directory_entry d WHERE d.group_id = g.id);

INSERT INTO "group" (id, kind, name, slug, bio, join_policy)
SELECT 'ad86d4e7-7028-4119-a2a2-295911d672ac', 'committee', 'Art and Merchandise Committee', 'art-and-merchandise-committee', 'Create and manage CMC merch, and work with local artists for poster art.', 'invite_only'
WHERE NOT EXISTS (SELECT 1 FROM "group" WHERE slug = 'art-and-merchandise-committee');

INSERT INTO directory_entry (id, group_id, name, bio, visibility)
SELECT '332cb4b1-b98a-41d3-b864-e08f9c8e1aae', g.id, g.name, g.bio, 'public'
FROM "group" g
WHERE g.slug = 'art-and-merchandise-committee'
  AND NOT EXISTS (SELECT 1 FROM directory_entry d WHERE d.group_id = g.id);

INSERT INTO "group" (id, kind, name, slug, bio, join_policy)
SELECT '5f5e1259-949d-455f-8e7d-8888c857d375', 'committee', 'Facility Committee', 'facility-committee', 'Manage the building, maintain the gear library, and handle rehearsal scheduling.', 'invite_only'
WHERE NOT EXISTS (SELECT 1 FROM "group" WHERE slug = 'facility-committee');

INSERT INTO directory_entry (id, group_id, name, bio, visibility)
SELECT '270c292c-5505-4454-b9a7-a6a309e2f737', g.id, g.name, g.bio, 'public'
FROM "group" g
WHERE g.slug = 'facility-committee'
  AND NOT EXISTS (SELECT 1 FROM directory_entry d WHERE d.group_id = g.id);
