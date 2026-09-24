ALTER TABLE `group` ADD `capability_grants` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `volunteer_role` ADD `capability_grants` text DEFAULT '[]' NOT NULL;