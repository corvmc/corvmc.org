ALTER TABLE `group_position` ADD `job` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_group_position_job` ON `group_position` (`job`) WHERE "group_position"."job" is not null;