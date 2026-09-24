ALTER TABLE `incident` ADD `event_id` text REFERENCES event_listing(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_incident_filer` ON `incident` (`reported_by_user_id`,`event_id`);