CREATE TABLE `announcement` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`author_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`notified_at` integer,
	`recipient_count` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_announcement_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_announcement_author_id_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_announcement_group` ON `announcement` (`group_id`,`pinned`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_announcement_notified` ON `announcement` (`notified_at`);