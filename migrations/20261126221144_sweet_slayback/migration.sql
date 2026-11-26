ALTER TABLE `ticket` ADD `event_band_id` text REFERENCES event_band(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_ticket_event_band` ON `ticket` (`event_band_id`);