ALTER TABLE `ticket` ADD `unit_price_cents` integer;--> statement-breakpoint
ALTER TABLE `ticket` ADD `contribution_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket` ADD `discount_waived` integer DEFAULT false NOT NULL;