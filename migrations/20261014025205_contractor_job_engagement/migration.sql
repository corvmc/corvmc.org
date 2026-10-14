PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contractor_job` (
	`id` text PRIMARY KEY,
	`contractor_id` text NOT NULL,
	`status` text DEFAULT 'asked' NOT NULL,
	`work_order_id` text NOT NULL,
	`scheduled_for` integer,
	`expected_back_at` integer,
	`completed_at` integer,
	`quoted_cents` integer,
	`cost_cents` integer,
	`is_donated` integer DEFAULT false NOT NULL,
	`fair_value_cents` integer,
	`fair_value_basis` text,
	`invoice_ref` text,
	`paid_at` integer,
	`requested_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_contractor_job_contractor_id_contractor_id_fk` FOREIGN KEY (`contractor_id`) REFERENCES `contractor`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_contractor_job_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_contractor_job_requested_by_user_id_user_id_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "contractor_job_cost_nonneg" CHECK(not (cost_cents < 0) and not (quoted_cents < 0))
);
--> statement-breakpoint
INSERT INTO `__new_contractor_job`(`id`, `contractor_id`, `status`, `work_order_id`, `scheduled_for`, `expected_back_at`, `completed_at`, `quoted_cents`, `cost_cents`, `is_donated`, `fair_value_cents`, `fair_value_basis`, `invoice_ref`, `paid_at`, `requested_by_user_id`, `notes`, `created_at`, `updated_at`) SELECT `id`, `contractor_id`, `status`, `work_order_id`, `scheduled_for`, `expected_back_at`, `completed_at`, `quoted_cents`, `cost_cents`, `is_donated`, `fair_value_cents`, `fair_value_basis`, `invoice_ref`, `paid_at`, `requested_by_user_id`, `notes`, `created_at`, `updated_at` FROM `contractor_job`;--> statement-breakpoint
DROP TABLE `contractor_job`;--> statement-breakpoint
ALTER TABLE `__new_contractor_job` RENAME TO `contractor_job`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contractor_job_asset`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contractor_job_project`;--> statement-breakpoint
CREATE INDEX `idx_contractor_job_contractor` ON `contractor_job` (`contractor_id`);--> statement-breakpoint
CREATE INDEX `idx_contractor_job_work_order` ON `contractor_job` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `idx_contractor_job_status` ON `contractor_job` (`status`);--> statement-breakpoint
CREATE INDEX `idx_contractor_job_overdue` ON `contractor_job` (`expected_back_at`) WHERE status = 'booked';