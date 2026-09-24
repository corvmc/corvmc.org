CREATE TABLE `incident` (
	`id` text PRIMARY KEY,
	`occurred_at` integer NOT NULL,
	`category` text NOT NULL,
	`location` text,
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`involved_user_id` text,
	`reported_by_user_id` text,
	`reported_by_name` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolved_by_user_id` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_incident_involved_user_id_user_id_fk` FOREIGN KEY (`involved_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_incident_reported_by_user_id_user_id_fk` FOREIGN KEY (`reported_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_incident_resolved_by_user_id_user_id_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `incident_note` (
	`id` text PRIMARY KEY,
	`incident_id` text NOT NULL,
	`author_user_id` text,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_incident_note_incident_id_incident_id_fk` FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_incident_note_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_incident_status` ON `incident` (`status`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_incident_category` ON `incident` (`category`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_incident_involved` ON `incident` (`involved_user_id`);--> statement-breakpoint
CREATE INDEX `idx_incident_note_incident` ON `incident_note` (`incident_id`,`created_at`);