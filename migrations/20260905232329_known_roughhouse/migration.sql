CREATE TABLE `lock_member_code` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`lock_access_id` text NOT NULL,
	`code` text,
	`label` text NOT NULL,
	`granted_by_staff_id` text,
	`synced_at` integer,
	`revoked_at` integer,
	`revoked_reason` text,
	`adopted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_lock_member_code_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_lock_member_code_granted_by_staff_id_user_id_fk` FOREIGN KEY (`granted_by_staff_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lock_member_code_access` ON `lock_member_code` (`lock_access_id`);--> statement-breakpoint
CREATE INDEX `idx_lock_member_code_user` ON `lock_member_code` (`user_id`,`revoked_at`);