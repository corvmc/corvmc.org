CREATE TABLE `instructor` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL UNIQUE,
	`status` text DEFAULT 'requested' NOT NULL,
	`headline` text,
	`blurb` text,
	`rates_note` text,
	`booking_url` text,
	`teaching_contact` text,
	`accepting_students` integer DEFAULT true NOT NULL,
	`application_note` text,
	`review_notes` text,
	`granted_by_user_id` text,
	`granted_at` integer,
	`status_changed_at` integer,
	`status_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_instructor_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_instructor_granted_by_user_id_user_id_fk` FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `instructor_status_idx` ON `instructor` (`status`,`created_at`);