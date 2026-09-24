CREATE TABLE `maintenance_schedule` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`project_id` text,
	`notes` text,
	`capacity` integer DEFAULT 1 NOT NULL,
	`interval_days` integer NOT NULL,
	`retired_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_maintenance_schedule_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_maintenance_schedule_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_maintenance_schedule_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "maintenance_schedule_interval_positive" CHECK(interval_days > 0),
	CONSTRAINT "maintenance_schedule_capacity_positive" CHECK(capacity > 0)
);
--> statement-breakpoint
ALTER TABLE `work_order` ADD `maintenance_schedule_id` text REFERENCES maintenance_schedule(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_open_occurrence` ON `work_order` (`maintenance_schedule_id`) WHERE maintenance_schedule_id is not null and resolved_at is null and cancelled_at is null;