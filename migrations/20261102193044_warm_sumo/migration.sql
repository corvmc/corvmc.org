CREATE TABLE `member_invite` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`name` text,
	`group_ids` text DEFAULT '[]' NOT NULL,
	`invited_by_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`sent_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`accepted_by_id` text,
	`accepted_at` integer,
	`revoked_by_id` text,
	`revoked_at` integer,
	CONSTRAINT `fk_member_invite_invited_by_id_user_id_fk` FOREIGN KEY (`invited_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_invite_accepted_by_id_user_id_fk` FOREIGN KEY (`accepted_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_invite_revoked_by_id_user_id_fk` FOREIGN KEY (`revoked_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_member_invite_pending` ON `member_invite` (`email`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `idx_member_invite_inviter_sent` ON `member_invite` (`invited_by_id`,`sent_at`);