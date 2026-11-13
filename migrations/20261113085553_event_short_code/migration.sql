ALTER TABLE `event_listing` ADD `short_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_short_code` ON `event_listing` (`short_code`);