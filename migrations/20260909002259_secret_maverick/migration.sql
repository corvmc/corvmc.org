CREATE TABLE `financial_entry` (
	`id` text PRIMARY KEY,
	`amount_cents` integer NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`settlement` text NOT NULL,
	`stripe_payment_record_id` text,
	`settlement_group` text,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`project_id` text,
	`user_id` text,
	`description` text NOT NULL,
	`recorded_by_user_id` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_financial_entry_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_financial_entry_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_financial_entry_recorded_by_user_id_user_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_financial_entry_occurred` ON `financial_entry` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_financial_entry_kind_occurred` ON `financial_entry` (`kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_financial_entry_category_occurred` ON `financial_entry` (`category`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_financial_entry_group` ON `financial_entry` (`settlement_group`);--> statement-breakpoint
CREATE INDEX `idx_financial_entry_stripe` ON `financial_entry` (`stripe_payment_record_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_entry_subject` ON `financial_entry` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_entry_project` ON `financial_entry` (`project_id`);