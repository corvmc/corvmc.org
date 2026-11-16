CREATE TABLE `door_access` (
	`id` text PRIMARY KEY,
	`reservation_id` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`outcome` text NOT NULL,
	`code_revealed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_door_access_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_door_access_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `pooled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `claimed_by_reservation_id` text REFERENCES reservation(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `revealed_at` integer;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `removed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_door_access_reservation` ON `door_access` (`reservation_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lock_fallback_live_claim` ON `lock_fallback_code` (`claimed_by_reservation_id`) WHERE removed_at IS NULL;