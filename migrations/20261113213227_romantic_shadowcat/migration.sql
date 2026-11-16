CREATE TABLE `outbox_message` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` integer DEFAULT (unixepoch()) NOT NULL,
	`claimed_until` integer,
	`provider_message_id` text,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_message_due` ON `outbox_message` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_outbox_message_subject` ON `outbox_message` (`subject_type`,`subject_id`);