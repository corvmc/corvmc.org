ALTER TABLE `duty_list` ADD `grant_stage` text;--> statement-breakpoint
ALTER TABLE `sponsorship` ADD `project_id` text REFERENCES project(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `sponsorship` ADD `funds_project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `grant_application` ADD `project_id` text REFERENCES project(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `grant_application` ADD `funds_project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `grant_report_application_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_duty_list_grant_stage` ON `duty_list` (`grant_stage`) WHERE grant_stage is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sponsorship_project` ON `sponsorship` (`project_id`) WHERE project_id is not null;--> statement-breakpoint
CREATE INDEX `sponsorship_funds_project_idx` ON `sponsorship` (`funds_project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_grant_application_project` ON `grant_application` (`project_id`) WHERE project_id is not null;--> statement-breakpoint
CREATE INDEX `grant_application_funds_project_idx` ON `grant_application` (`funds_project_id`);--> statement-breakpoint
DROP TABLE `grant_report`;