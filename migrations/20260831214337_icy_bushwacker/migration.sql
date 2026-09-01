CREATE TABLE `contact` (
	`id` text PRIMARY KEY,
	`entry_id` text,
	`subscriber_id` text,
	`booking_name` text,
	`booking_email` text,
	`booking_phone` text,
	`notes` text,
	`payment_ref` text,
	`source` text NOT NULL,
	`retain_until` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_contact_entry_id_directory_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_contact_subscriber_id_subscriber_id_fk` FOREIGN KEY (`subscriber_id`) REFERENCES `subscriber`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contact_entry` ON `contact` (`entry_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_subscriber` ON `contact` (`subscriber_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_retain_until` ON `contact` (`retain_until`);