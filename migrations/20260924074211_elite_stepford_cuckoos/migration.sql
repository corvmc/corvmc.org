CREATE TABLE `access_holding` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`holder_user_id` text,
	`holder_name` text NOT NULL,
	`issued_at` integer NOT NULL,
	`issued_by_user_id` text,
	`notes` text,
	`returned_at` integer,
	`returned_by_user_id` text,
	`return_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_access_holding_holder_user_id_user_id_fk` FOREIGN KEY (`holder_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_access_holding_issued_by_user_id_user_id_fk` FOREIGN KEY (`issued_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_access_holding_returned_by_user_id_user_id_fk` FOREIGN KEY (`returned_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_access_holding_open` ON `access_holding` (`returned_at`,`issued_at`);--> statement-breakpoint
CREATE INDEX `idx_access_holding_holder` ON `access_holding` (`holder_user_id`);