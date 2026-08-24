CREATE TABLE `member_standing` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`triggering_flag_id` text,
	`updated_by_user_id` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `member_standing_pk` PRIMARY KEY(`user_id`, `scope`),
	CONSTRAINT `fk_member_standing_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_standing_triggering_flag_id_content_flag_id_fk` FOREIGN KEY (`triggering_flag_id`) REFERENCES `content_flag`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_standing_updated_by_user_id_user_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `user` ADD `accepts_direct_messages` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_member_standing_scope_status` ON `member_standing` (`scope`,`status`);