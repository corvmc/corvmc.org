-- A show with sets keeps the changeover its running order already walks (#3272):
-- the first set's, which was the per-set default. A show with none takes 15.
UPDATE `production` SET `changeover_minutes` = (
	SELECT `s`.`changeover_minutes` FROM `production_slot` `s`
	WHERE `s`.`production_id` = `production`.`id`
	ORDER BY `s`.`sort_order`, `s`.`created_at` LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM `production_slot` `s` WHERE `s`.`production_id` = `production`.`id`);
