CREATE TABLE `group_announcement` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`author_name` text,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`message_id` text,
	`notified_at` integer,
	`recipient_count` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_group_announcement_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_group_announcement_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_group_announcement_message_id_inbox_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `inbox_message`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_group_announcement_group` ON `group_announcement` (`group_id`,`pinned`,`published_at`);