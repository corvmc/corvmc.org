CREATE TABLE `production_slot` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`event_band_id` text,
	`sort_order` real NOT NULL,
	`set_length_minutes` integer NOT NULL,
	`changeover_minutes` integer DEFAULT 10 NOT NULL,
	`scheduled_start_at` integer,
	`soundcheck_at` integer,
	`tech_notes` text,
	`backline_needs` text,
	`hospitality_notes` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_slot_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_slot_event_band_id_event_band_id_fk` FOREIGN KEY (`event_band_id`) REFERENCES `event_band`(`id`) ON DELETE SET NULL,
	CONSTRAINT "production_slot_set_length_positive" CHECK(set_length_minutes > 0),
	CONSTRAINT "production_slot_changeover_nonneg" CHECK(changeover_minutes >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_production_slot_order` ON `production_slot` (`production_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_slot_event_band` ON `production_slot` (`event_band_id`) WHERE event_band_id is not null;