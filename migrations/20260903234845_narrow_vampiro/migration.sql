CREATE TABLE `inbox_group_read` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_group_read_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_group_read_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `group_id` text REFERENCES `group`(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_group_read_thread_user` ON `inbox_group_read` (`thread_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_inbox_group_read_user` ON `inbox_group_read` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_group` ON `inbox_thread` (`group_id`,`status`,`last_message_at`);