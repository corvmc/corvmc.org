CREATE TABLE `sponsor` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`website` text,
	`contact_name` text,
	`contact_email` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sponsorship` (
	`id` text PRIMARY KEY,
	`sponsor_id` text NOT NULL,
	`title` text NOT NULL,
	`tier` text,
	`status` text DEFAULT 'prospect' NOT NULL,
	`amount_cents` integer,
	`starts_on` text,
	`ends_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_sponsorship_sponsor_id_sponsor_id_fk` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsor`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `funder` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`website` text,
	`contact_name` text,
	`contact_email` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grant_application` (
	`id` text PRIMARY KEY,
	`funder_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'prospect' NOT NULL,
	`amount_requested_cents` integer,
	`amount_awarded_cents` integer,
	`apply_by` text,
	`starts_on` text,
	`ends_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_grant_application_funder_id_funder_id_fk` FOREIGN KEY (`funder_id`) REFERENCES `funder`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `grant_report` (
	`id` text PRIMARY KEY,
	`grant_application_id` text NOT NULL,
	`title` text NOT NULL,
	`due_on` text NOT NULL,
	`submitted_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_grant_report_grant_application_id_grant_application_id_fk` FOREIGN KEY (`grant_application_id`) REFERENCES `grant_application`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `sponsorship_sponsor_idx` ON `sponsorship` (`sponsor_id`);--> statement-breakpoint
CREATE INDEX `grant_application_funder_idx` ON `grant_application` (`funder_id`);--> statement-breakpoint
CREATE INDEX `grant_application_status_idx` ON `grant_application` (`status`);--> statement-breakpoint
CREATE INDEX `grant_report_application_idx` ON `grant_report` (`grant_application_id`);