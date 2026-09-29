CREATE TABLE `project_committee` (
	`project_id` text NOT NULL,
	`group_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `project_committee_pk` PRIMARY KEY(`project_id`, `group_id`),
	CONSTRAINT `fk_project_committee_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_committee_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `production` ADD `project_id` text REFERENCES project(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `project` ADD `kind` text DEFAULT 'general' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_project` ON `production` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_kind` ON `project` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_project_committee_group` ON `project_committee` (`group_id`);