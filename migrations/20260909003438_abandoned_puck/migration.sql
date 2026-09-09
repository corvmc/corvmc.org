CREATE TABLE `production_expense` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`deductible` integer DEFAULT true NOT NULL,
	`paid_to` text,
	`paid_at` integer,
	`notes` text,
	`recorded_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_expense_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_expense_recorded_by_user_id_user_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_production_expense_production` ON `production_expense` (`production_id`,`category`);