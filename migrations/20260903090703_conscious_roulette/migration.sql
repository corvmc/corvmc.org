ALTER TABLE `event` ADD `ticket_price_floor_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket` ADD `acts_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket` ADD `collective_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket` ADD `fee_covered_cents` integer DEFAULT 0 NOT NULL;