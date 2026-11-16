CREATE TABLE `inventory_kit_loan` (
	`id` text PRIMARY KEY,
	`location_id` text,
	`location_name` text NOT NULL,
	`user_id` text NOT NULL,
	`checked_out_by_id` text,
	`checked_out_at` integer NOT NULL,
	`due_date` integer,
	`returned_at` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inventory_kit_loan_location_id_inventory_location_id_fk` FOREIGN KEY (`location_id`) REFERENCES `inventory_location`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_inventory_kit_loan_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inventory_kit_loan_checked_out_by_id_user_id_fk` FOREIGN KEY (`checked_out_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `inventory_loan` ADD `kit_loan_id` text REFERENCES inventory_kit_loan(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_kit_loan_location` ON `inventory_kit_loan` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_kit_loan_user` ON `inventory_kit_loan` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_loan_kit` ON `inventory_loan` (`kit_loan_id`);