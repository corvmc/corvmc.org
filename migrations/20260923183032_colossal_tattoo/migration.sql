CREATE TABLE `ticket_sale` (
	`id` text PRIMARY KEY,
	`event_listing_id` text NOT NULL,
	`group_id` text,
	`enabled` integer DEFAULT false NOT NULL,
	`price_cents` integer,
	`price_floor_cents` integer DEFAULT 0 NOT NULL,
	`quantity` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_ticket_sale_event_listing_id_event_listing_id_fk` FOREIGN KEY (`event_listing_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ticket_sale_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ticket_sale_event` ON `ticket_sale` (`event_listing_id`);--> statement-breakpoint
CREATE INDEX `idx_ticket_sale_group` ON `ticket_sale` (`group_id`);