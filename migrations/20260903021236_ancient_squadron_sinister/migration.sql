CREATE TABLE `file` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`description` text,
	`uploaded_by_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_file_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_file_uploaded_by_id_user_id_fk` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_file_group` ON `file` (`group_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_file_key` ON `file` (`key`);--> statement-breakpoint
CREATE INDEX `idx_file_deleted` ON `file` (`deleted_at`);