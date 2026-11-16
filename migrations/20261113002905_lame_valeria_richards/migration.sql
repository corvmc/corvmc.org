CREATE TABLE `work_order_dependency` (
	`work_order_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `work_order_dependency_pk` PRIMARY KEY(`work_order_id`, `depends_on_id`),
	CONSTRAINT `fk_work_order_dependency_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_dependency_depends_on_id_work_order_id_fk` FOREIGN KEY (`depends_on_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_dependency_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "work_order_dependency_not_self" CHECK(work_order_id <> depends_on_id)
);
--> statement-breakpoint
CREATE INDEX `work_order_dependency_depends_on_idx` ON `work_order_dependency` (`depends_on_id`);