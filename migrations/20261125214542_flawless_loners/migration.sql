ALTER TABLE `production` ADD `changeover_minutes` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `production` ADD `load_in_done_at` integer;--> statement-breakpoint
ALTER TABLE `production` ADD `soundcheck_done_at` integer;--> statement-breakpoint
ALTER TABLE `production` ADD `doors_done_at` integer;--> statement-breakpoint
ALTER TABLE `production` ADD `curfew_done_at` integer;--> statement-breakpoint
ALTER TABLE `production` ADD `load_out_done_at` integer;