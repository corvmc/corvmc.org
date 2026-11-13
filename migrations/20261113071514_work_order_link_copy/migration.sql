-- Copy work_order.asset_id and reservation_id into work_order_link (#2622). Production
-- holds none; this keeps any that a local or preview database has.
INSERT INTO `work_order_link` (`id`, `work_order_id`, `asset_id`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, `asset_id`, `created_at` FROM `work_order`
WHERE `asset_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `work_order_link` (`id`, `work_order_id`, `reservation_id`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, `reservation_id`, `created_at` FROM `work_order`
WHERE `reservation_id` IS NOT NULL;
