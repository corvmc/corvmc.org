CREATE TABLE `committee_application` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`withdrawn_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_committee_application_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `committee_application_choice` (
	`id` text PRIMARY KEY,
	`application_id` text NOT NULL,
	`group_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`review_notes` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_committee_application_choice_application_id_committee_application_id_fk` FOREIGN KEY (`application_id`) REFERENCES `committee_application`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_committee_application_choice_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_committee_application_choice_decided_by_user_id_user_id_fk` FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `committee_application_choice_unique` UNIQUE(`application_id`,`group_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_committee_application_user` ON `committee_application` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_committee_choice_group_status` ON `committee_application_choice` (`group_id`,`status`);