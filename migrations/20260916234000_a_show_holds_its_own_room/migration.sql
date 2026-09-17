-- Re-point the room holds at the party responsible for them.
--
-- `booker_type = 'event_listing'` was a fossil of production and listing having
-- once been one thing (#853). An advertisement does not book a room: a show's
-- room is its production's, a programme's is the group's.

-- A show whose listing predates the production table has none to point at, so
-- open one. Its id is the listing's, which is what makes the link exact in one
-- statement — they are different tables and the value only has to be unique
-- within this one.
INSERT INTO `production` (`id`, `status`, `created_at`, `updated_at`)
SELECT `e`.`id`, 'draft', unixepoch(), unixepoch()
  FROM `event_listing` `e`
 WHERE `e`.`production_id` IS NULL
   AND `e`.`source` = 'cmc'
   AND EXISTS (SELECT 1 FROM `reservation` `r`
                WHERE `r`.`booker_type` = 'event_listing' AND `r`.`booker_id` = `e`.`id`);
--> statement-breakpoint
UPDATE `event_listing`
   SET `production_id` = `id`
 WHERE `production_id` IS NULL
   AND EXISTS (SELECT 1 FROM `production` `p` WHERE `p`.`id` = `event_listing`.`id`);
--> statement-breakpoint
-- A programme's session: the room is the group's, free. `group.kind` is what
-- says free-versus-paid, never the booker type.
UPDATE `reservation`
   SET `booker_type` = 'group',
       `booker_id` = (SELECT `e`.`group_id` FROM `event_listing` `e` WHERE `e`.`id` = `reservation`.`booker_id`)
 WHERE `booker_type` = 'event_listing'
   AND EXISTS (SELECT 1 FROM `event_listing` `e`
                WHERE `e`.`id` = `reservation`.`booker_id` AND `e`.`group_id` IS NOT NULL);
--> statement-breakpoint
UPDATE `reservation`
   SET `booker_type` = 'production',
       `booker_id` = (SELECT `e`.`production_id` FROM `event_listing` `e` WHERE `e`.`id` = `reservation`.`booker_id`)
 WHERE `booker_type` = 'event_listing'
   AND EXISTS (SELECT 1 FROM `event_listing` `e`
                WHERE `e`.`id` = `reservation`.`booker_id` AND `e`.`production_id` IS NOT NULL);
