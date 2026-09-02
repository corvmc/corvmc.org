CREATE TABLE `inbox_saved_view` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_saved_view_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_inbox_saved_view_user` ON `inbox_saved_view` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_saved_view_user_name` ON `inbox_saved_view` (`user_id`,`name`);