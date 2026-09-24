CREATE TABLE `ballot` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`group_id` text,
	`title` text NOT NULL,
	`description` text,
	`closes_at` integer NOT NULL,
	`certifier_id` text,
	`created_by_id` text,
	`opened_at` integer,
	`electorate_size` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`certified_at` integer,
	`certified_by_id` text,
	`certified_result` text,
	`result_published_at` integer,
	`open_notice_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_ballot_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_certifier_id_user_id_fk` FOREIGN KEY (`certifier_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_ballot_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_ballot_certified_by_id_user_id_fk` FOREIGN KEY (`certified_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "ballot_group_iff_group_kind" CHECK((kind = 'group') = (group_id is not null)),
	CONSTRAINT "ballot_cancel_has_reason" CHECK((cancelled_at is null) = (cancel_reason is null))
);
--> statement-breakpoint
CREATE TABLE `ballot_choice` (
	`ballot_id` text NOT NULL,
	`option_id` text NOT NULL,
	`votes` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `ballot_choice_pk` PRIMARY KEY(`ballot_id`, `option_id`),
	CONSTRAINT `fk_ballot_choice_ballot_id_ballot_id_fk` FOREIGN KEY (`ballot_id`) REFERENCES `ballot`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_choice_option_id_ballot_option_id_fk` FOREIGN KEY (`option_id`) REFERENCES `ballot_option`(`id`) ON DELETE CASCADE,
	CONSTRAINT "ballot_choice_votes_nonnegative" CHECK(votes >= 0)
);
--> statement-breakpoint
CREATE TABLE `ballot_elector` (
	`ballot_id` text NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT `ballot_elector_pk` PRIMARY KEY(`ballot_id`, `user_id`),
	CONSTRAINT `fk_ballot_elector_ballot_id_ballot_id_fk` FOREIGN KEY (`ballot_id`) REFERENCES `ballot`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_elector_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ballot_elector_override` (
	`id` text PRIMARY KEY,
	`ballot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`include` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_ballot_elector_override_ballot_id_ballot_id_fk` FOREIGN KEY (`ballot_id`) REFERENCES `ballot`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_elector_override_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_elector_override_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `ballot_option` (
	`id` text PRIMARY KEY,
	`ballot_id` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `fk_ballot_option_ballot_id_ballot_id_fk` FOREIGN KEY (`ballot_id`) REFERENCES `ballot`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ballot_participation` (
	`ballot_id` text NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT `ballot_participation_pk` PRIMARY KEY(`ballot_id`, `user_id`),
	CONSTRAINT `fk_ballot_participation_ballot_id_ballot_id_fk` FOREIGN KEY (`ballot_id`) REFERENCES `ballot`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_participation_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ballot_recorded_vote` (
	`ballot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`option_id` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `ballot_recorded_vote_pk` PRIMARY KEY(`ballot_id`, `user_id`),
	CONSTRAINT `fk_ballot_recorded_vote_ballot_id_ballot_id_fk` FOREIGN KEY (`ballot_id`) REFERENCES `ballot`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_recorded_vote_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ballot_recorded_vote_option_id_ballot_option_id_fk` FOREIGN KEY (`option_id`) REFERENCES `ballot_option`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `ballot_group_idx` ON `ballot` (`group_id`);--> statement-breakpoint
CREATE INDEX `ballot_closes_at_idx` ON `ballot` (`closes_at`);--> statement-breakpoint
CREATE INDEX `ballot_elector_user_idx` ON `ballot_elector` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ballot_elector_override_uq` ON `ballot_elector_override` (`ballot_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ballot_option_position_uq` ON `ballot_option` (`ballot_id`,`position`);