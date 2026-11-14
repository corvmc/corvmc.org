CREATE TABLE `group_position` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_group_position_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `group_position_holder` (
	`position_id` text NOT NULL,
	`member_id` text NOT NULL,
	`assigned_by_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `group_position_holder_pk` PRIMARY KEY(`position_id`, `member_id`),
	CONSTRAINT `fk_group_position_holder_position_id_group_position_id_fk` FOREIGN KEY (`position_id`) REFERENCES `group_position`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_group_position_holder_member_id_group_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `group_member`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_group_position_holder_assigned_by_id_user_id_fk` FOREIGN KEY (`assigned_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_group_position_name` ON `group_position` (`group_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_group_position_holder_member` ON `group_position_holder` (`member_id`);