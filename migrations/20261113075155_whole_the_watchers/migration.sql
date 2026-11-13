ALTER TABLE `inbox_thread` ADD `organization_id` text REFERENCES organization(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `contact_id` text REFERENCES contact(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_organization` ON `inbox_thread` (`organization_id`) WHERE organization_id is not null;--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact` ON `inbox_thread` (`contact_id`) WHERE contact_id is not null;