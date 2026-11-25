ALTER TABLE `rider_element` ADD `outlets` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rider_input` ADD `provided_by` text DEFAULT 'venue' NOT NULL;