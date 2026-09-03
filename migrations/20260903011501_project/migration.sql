CREATE TABLE `project` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`group_id` text,
	`suggestion_id` text,
	`budget_cents` integer,
	`starts_at` integer,
	`ends_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_project_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_project_suggestion_id_suggestion_id_fk` FOREIGN KEY (`suggestion_id`) REFERENCES `suggestion`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_project_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "project_budget_nonneg" CHECK(not (budget_cents < 0)),
	CONSTRAINT "project_ends_after_start" CHECK(starts_at is null or ends_at is null or ends_at > starts_at)
);
--> statement-breakpoint
ALTER TABLE `event` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `acquisition` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `purchase_order` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `work_order` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `contractor_job` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_event_project` ON `event` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_acquisition_project` ON `acquisition` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_project` ON `purchase_order` (`project_id`);--> statement-breakpoint
CREATE INDEX `work_order_project_idx` ON `work_order` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_contractor_job_project` ON `contractor_job` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_group` ON `project` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_project_status` ON `project` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_suggestion` ON `project` (`suggestion_id`) WHERE suggestion_id is not null;