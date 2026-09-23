CREATE TABLE `local_resource` (
	`id` text PRIMARY KEY,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`website` text,
	`phone` text,
	`address_line` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_by_user_id` text,
	`submitter_email` text,
	`staff_note` text,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_local_resource_category_id_local_resource_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `local_resource_category`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_local_resource_submitted_by_user_id_user_id_fk` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_local_resource_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `local_resource_category` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_local_resource_public` ON `local_resource` (`status`,`category_id`);--> statement-breakpoint
CREATE INDEX `idx_local_resource_status` ON `local_resource` (`status`);