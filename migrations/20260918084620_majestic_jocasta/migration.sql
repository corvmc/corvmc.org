ALTER TABLE `acquisition` ADD `suggestion_id` text;--> statement-breakpoint
CREATE INDEX `idx_acquisition_suggestion` ON `acquisition` (`suggestion_id`);