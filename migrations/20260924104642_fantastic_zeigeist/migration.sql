ALTER TABLE `market_day` ADD `table_fee_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `market_day` ADD `sliding_scale` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `market_day` ADD `sliding_scale_floor_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `fee_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `fee_floor_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `paid_cents` integer;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `stripe_payment_record_id` text;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `refunded_at` integer;