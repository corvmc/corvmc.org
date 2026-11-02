ALTER TABLE `lock_fallback_code` ADD `pooled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `claimed_by_reservation_id` text REFERENCES reservation(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `revealed_at` integer;--> statement-breakpoint
ALTER TABLE `lock_fallback_code` ADD `removed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lock_fallback_live_claim` ON `lock_fallback_code` (`claimed_by_reservation_id`) WHERE removed_at IS NULL;