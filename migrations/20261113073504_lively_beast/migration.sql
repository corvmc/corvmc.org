CREATE TABLE `activity` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`contact_id` text,
	`kind` text NOT NULL,
	`occurred_on` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_activity_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_activity_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_activity_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "activity_one_owner" CHECK((organization_id is null) <> (contact_id is null))
);
--> statement-breakpoint
CREATE INDEX `idx_activity_organization` ON `activity` (`organization_id`,`occurred_on`) WHERE organization_id is not null;--> statement-breakpoint
CREATE INDEX `idx_activity_contact` ON `activity` (`contact_id`,`occurred_on`) WHERE contact_id is not null;