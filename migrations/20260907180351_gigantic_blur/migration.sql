ALTER TABLE `production_slot` ADD `guarantee_cents` integer;--> statement-breakpoint
ALTER TABLE `production_slot` ADD `percentage_bps` integer;--> statement-breakpoint
ALTER TABLE `production_slot` ADD `versus` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `production_slot` ADD `against_net` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `production_slot` ADD `contributed` integer DEFAULT false NOT NULL;