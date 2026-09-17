ALTER TABLE `event_listing` ADD `production_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_production` ON `event_listing` (`production_id`);