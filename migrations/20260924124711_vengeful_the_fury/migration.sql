ALTER TABLE `incident` ADD `retain` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_incident_retention` ON `incident` (`retain`,`occurred_at`);