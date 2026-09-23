CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY,
	`action` text NOT NULL,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_label` text,
	`details` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_audit_log_actor_user_id_user_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_subject_idx` ON `audit_log` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);