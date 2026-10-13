-- Every work order that existed before posting did is on the claim board, so it
-- counts as posted when it was created. Idempotent: only unposted rows with a
-- role (the CHECK refuses a posted row without one) are touched.
UPDATE `work_order` SET `posted_at` = `created_at` WHERE `posted_at` IS NULL AND `volunteer_role_id` IS NOT NULL;
