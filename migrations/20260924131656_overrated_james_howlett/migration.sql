CREATE TABLE `sponsor_placement` (
	`id` text PRIMARY KEY,
	`sponsorship_id` text NOT NULL,
	`event_id` text NOT NULL,
	`on_event_page` integer DEFAULT true NOT NULL,
	`in_campaign` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_sponsor_placement_sponsorship_id_sponsorship_id_fk` FOREIGN KEY (`sponsorship_id`) REFERENCES `sponsorship`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sponsor_placement_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_placement_term_event_idx` ON `sponsor_placement` (`sponsorship_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `sponsor_placement_event_idx` ON `sponsor_placement` (`event_id`);