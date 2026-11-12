CREATE TABLE `party_role` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`contact_id` text,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_party_role_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_party_role_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE CASCADE,
	CONSTRAINT "party_role_one_owner" CHECK((organization_id is null) <> (contact_id is null))
);
--> statement-breakpoint
CREATE TABLE `contractor_detail` (
	`organization_id` text PRIMARY KEY,
	`trade` text NOT NULL,
	`license_number` text,
	`insurance_expires_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_contractor_detail_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`website` text,
	`notes` text,
	`directory_entry_id` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_organization_directory_entry_id_directory_entry_id_fk` FOREIGN KEY (`directory_entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `contact` ADD `organization_id` text REFERENCES organization(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `contact` ADD `user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `contact` ADD `name` text;--> statement-breakpoint
ALTER TABLE `contact` ADD `role` text;--> statement-breakpoint
ALTER TABLE `contact` ADD `email` text;--> statement-breakpoint
ALTER TABLE `contact` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `contractor_job` ADD `organization_id` text NOT NULL REFERENCES organization(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `sponsorship` ADD `organization_id` text NOT NULL REFERENCES organization(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `grant_application` ADD `organization_id` text NOT NULL REFERENCES organization(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX `idx_contact_organization` ON `contact` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_user` ON `contact` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_email` ON `contact` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_party_role_organization` ON `party_role` (`organization_id`,`role`) WHERE organization_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_party_role_contact` ON `party_role` (`contact_id`,`role`) WHERE contact_id is not null;--> statement-breakpoint
CREATE INDEX `idx_party_role_role` ON `party_role` (`role`);--> statement-breakpoint
CREATE INDEX `idx_contractor_detail_trade` ON `contractor_detail` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_organization_name` ON `organization` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_organization_directory_entry` ON `organization` (`directory_entry_id`) WHERE directory_entry_id is not null;--> statement-breakpoint
CREATE INDEX `idx_contractor_job_organization` ON `contractor_job` (`organization_id`);--> statement-breakpoint
CREATE INDEX `sponsorship_organization_idx` ON `sponsorship` (`organization_id`);--> statement-breakpoint
CREATE INDEX `grant_application_organization_idx` ON `grant_application` (`organization_id`);