-- A listing's production is found through its project from here on (#2076), so
-- `event_listing.production_id` goes in the next migration. First every listing
-- that names a production names that production's project too. Idempotent.
UPDATE `event_listing`
SET `project_id` = (SELECT p.project_id FROM `production` p WHERE p.id = `event_listing`.`production_id`),
	`updated_at` = unixepoch()
WHERE `production_id` IS NOT NULL
	AND (SELECT p.project_id FROM `production` p WHERE p.id = `event_listing`.`production_id`) IS NOT NULL
	AND (`project_id` IS NULL
		OR `project_id` != (SELECT p.project_id FROM `production` p WHERE p.id = `event_listing`.`production_id`));
