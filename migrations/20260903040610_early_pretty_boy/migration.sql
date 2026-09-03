ALTER TABLE `volunteer_role` ADD `is_specialized_skill` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `volunteer_role` ADD `market_rate_cents` integer;--> statement-breakpoint
ALTER TABLE `contractor_job` ADD `is_donated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `contractor_job` ADD `fair_value_cents` integer;--> statement-breakpoint
ALTER TABLE `contractor_job` ADD `fair_value_basis` text;