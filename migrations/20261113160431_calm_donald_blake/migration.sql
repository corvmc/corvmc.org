ALTER TABLE `project` ADD `parent_project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_project_parent` ON `project` (`parent_project_id`);