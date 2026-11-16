CREATE TABLE `donation` (
	`id` text PRIMARY KEY,
	`payment_intent_id` text NOT NULL,
	`event_id` text,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`taken_by_user_id` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_donation_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_donation_taken_by_user_id_user_id_fk` FOREIGN KEY (`taken_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_donation_payment_intent` ON `donation` (`payment_intent_id`);--> statement-breakpoint
CREATE INDEX `idx_donation_event` ON `donation` (`event_id`);