ALTER TABLE `work_order` ADD `anchor` text;--> statement-breakpoint
ALTER TABLE `work_order` ADD `is_orientation` integer DEFAULT false NOT NULL;