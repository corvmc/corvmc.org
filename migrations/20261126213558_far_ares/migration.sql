CREATE TABLE `production_till_count` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`kind` text NOT NULL,
	`cash_cents` integer NOT NULL,
	`counted_by_user_id` text,
	`counted_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_till_count_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_till_count_counted_by_user_id_user_id_fk` FOREIGN KEY (`counted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "production_till_count_cash_nonneg" CHECK(cash_cents >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_production_till_count_production` ON `production_till_count` (`production_id`,`counted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_till_count_staff` ON `production_till_count` (`production_id`) WHERE kind = 'staff';