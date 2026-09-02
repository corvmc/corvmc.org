CREATE TABLE `contractor` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`trade` text NOT NULL,
	`contact_name` text,
	`phone` text,
	`email` text,
	`website` text,
	`license_number` text,
	`insurance_expires_at` integer,
	`notes` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contractor_job` (
	`id` text PRIMARY KEY,
	`contractor_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`summary` text NOT NULL,
	`asset_id` text,
	`scheduled_for` integer,
	`expected_back_at` integer,
	`completed_at` integer,
	`quoted_cents` integer,
	`cost_cents` integer,
	`invoice_ref` text,
	`paid_at` integer,
	`requested_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_contractor_job_contractor_id_contractor_id_fk` FOREIGN KEY (`contractor_id`) REFERENCES `contractor`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_contractor_job_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_contractor_job_requested_by_user_id_user_id_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "contractor_job_cost_nonneg" CHECK(not (cost_cents < 0) and not (quoted_cents < 0))
);
--> statement-breakpoint
CREATE INDEX `idx_contractor_trade` ON `contractor` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_contractor_active` ON `contractor` (`name`) WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX `idx_contractor_insurance` ON `contractor` (`insurance_expires_at`) WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX `idx_contractor_job_contractor` ON `contractor_job` (`contractor_id`);--> statement-breakpoint
CREATE INDEX `idx_contractor_job_asset` ON `contractor_job` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_contractor_job_status` ON `contractor_job` (`status`);--> statement-breakpoint
CREATE INDEX `idx_contractor_job_overdue` ON `contractor_job` (`expected_back_at`) WHERE status = 'scheduled';