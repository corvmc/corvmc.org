-- Today's two door counts become till counts (#3273): the first count is a
-- handoff, the recount is the staff count. The six door_cash_* columns stay,
-- unread.
INSERT INTO `production_till_count` (`id`, `production_id`, `kind`, `cash_cents`, `counted_by_user_id`, `counted_at`)
SELECT lower(hex(randomblob(16))), `id`, 'handoff', `door_cash_cents`, `door_cash_counted_by_user_id`, coalesce(`door_cash_counted_at`, `updated_at`)
FROM `production` WHERE `door_cash_cents` IS NOT NULL;--> statement-breakpoint
INSERT INTO `production_till_count` (`id`, `production_id`, `kind`, `cash_cents`, `counted_by_user_id`, `counted_at`)
SELECT lower(hex(randomblob(16))), `id`, 'staff', `door_cash_recount_cents`, `door_cash_recounted_by_user_id`, coalesce(`door_cash_recounted_at`, `updated_at`)
FROM `production` WHERE `door_cash_recount_cents` IS NOT NULL;
