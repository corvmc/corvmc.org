CREATE TABLE `agreement` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`counterparty` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'prospect' NOT NULL,
	`amount_cents` integer,
	`tier` text,
	`contact_name` text,
	`contact_email` text,
	`apply_by` text,
	`starts_on` text,
	`ends_on` text,
	`report_due_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agreement_status_idx` ON `agreement` (`status`);