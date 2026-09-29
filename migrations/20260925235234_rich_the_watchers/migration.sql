ALTER TABLE `project` ADD `ballot_id` text REFERENCES ballot(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `ballot` ADD `suggestion_id` text REFERENCES suggestion(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `ballot` ADD `project_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_ballot` ON `project` (`ballot_id`) WHERE ballot_id is not null;--> statement-breakpoint
CREATE INDEX `ballot_suggestion_idx` ON `ballot` (`suggestion_id`);--> statement-breakpoint
CREATE INDEX `ballot_project_idx` ON `ballot` (`project_id`);