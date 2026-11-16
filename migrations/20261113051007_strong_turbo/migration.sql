CREATE TABLE `duty_list_item_dependency` (
	`item_id` text NOT NULL,
	`depends_on_item_id` text NOT NULL,
	CONSTRAINT `duty_list_item_dependency_pk` PRIMARY KEY(`item_id`, `depends_on_item_id`),
	CONSTRAINT `fk_duty_list_item_dependency_item_id_duty_list_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `duty_list_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_duty_list_item_dependency_depends_on_item_id_duty_list_item_id_fk` FOREIGN KEY (`depends_on_item_id`) REFERENCES `duty_list_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT "duty_list_item_dependency_not_self" CHECK(item_id <> depends_on_item_id)
);
--> statement-breakpoint
CREATE INDEX `duty_list_item_dependency_depends_on_idx` ON `duty_list_item_dependency` (`depends_on_item_id`);
--> statement-breakpoint
-- The grant application's natural order (#2625): the budget follows the narrative, and
-- submitting follows the budget and the letters. Only adds; matched by title within the
-- application template, so a renamed or deleted item is skipped rather than guessed at.
WITH edge(item_title, depends_on_title) AS (VALUES
	('Build the budget', 'Draft the narrative'),
	('Submit the application', 'Build the budget'),
	('Submit the application', 'Collect letters of support')
)
INSERT OR IGNORE INTO duty_list_item_dependency (item_id, depends_on_item_id)
SELECT a.id, b.id
FROM edge e
JOIN duty_list dl ON dl.grant_stage = 'application'
JOIN duty_list_item a ON a.duty_list_id = dl.id AND a.title = e.item_title
JOIN duty_list_item b ON b.duty_list_id = dl.id AND b.title = e.depends_on_title;