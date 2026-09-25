CREATE TABLE `group_capability` (
	`group_id` text NOT NULL,
	`capability` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `group_capability_pk` PRIMARY KEY(`group_id`, `capability`),
	CONSTRAINT `fk_group_capability_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `volunteer_role_capability` (
	`volunteer_role_id` text NOT NULL,
	`capability` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `volunteer_role_capability_pk` PRIMARY KEY(`volunteer_role_id`, `capability`),
	CONSTRAINT `fk_volunteer_role_capability_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE CASCADE
);
