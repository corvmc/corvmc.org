CREATE TABLE `reminder_sent` (
	`id` text PRIMARY KEY,
	`reminder_key` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_sent_once` ON `reminder_sent` (`reminder_key`,`subject_id`);--> statement-breakpoint
CREATE INDEX `reminder_sent_at_idx` ON `reminder_sent` (`sent_at`);