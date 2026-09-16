-- Copy the edge before the column that holds it goes.
--
-- `production.event_id` said which listing a production hung off; `production_id`
-- says which production a listing announces. Same edge, named from the side that
-- makes the listing an advertisement rather than the root (#1202).
UPDATE `event_listing`
   SET `production_id` = (SELECT `p`.`id` FROM `production` `p` WHERE `p`.`event_id` = `event_listing`.`id`)
 WHERE EXISTS (SELECT 1 FROM `production` `p` WHERE `p`.`event_id` = `event_listing`.`id`);
