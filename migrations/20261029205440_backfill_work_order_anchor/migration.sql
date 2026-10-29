-- Stamp the facts every stamped work order used to read off its duty list (#2033).
-- Idempotent: only rows still unstamped are touched.
UPDATE `work_order` SET `anchor` = (SELECT `anchor` FROM `duty_list` WHERE `duty_list`.`id` = `work_order`.`duty_list_id`) WHERE `anchor` IS NULL AND `duty_list_id` IS NOT NULL;--> statement-breakpoint
UPDATE `work_order` SET `is_orientation` = 1 WHERE `is_orientation` = 0 AND `reservation_id` IS NOT NULL AND (`duty_list_id` IN (SELECT `id` FROM `duty_list` WHERE `auto_apply_on` = 'reservation.first') OR `id` IN (SELECT `work_order_id` FROM `member_orientation` WHERE `work_order_id` IS NOT NULL));
