ALTER TABLE `campaign` ADD `event_id` text;--> statement-breakpoint
CREATE INDEX `idx_campaign_event` ON `campaign` (`event_id`);