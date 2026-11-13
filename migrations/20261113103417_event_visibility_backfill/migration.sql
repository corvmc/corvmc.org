-- #2662: a meeting owned by a group takes its owner's default from
-- `defaultVisibility`; every other row stays public.
UPDATE `event_listing`
SET `visibility` = CASE (SELECT `kind` FROM `group` WHERE `group`.`id` = `event_listing`.`group_id`)
	WHEN 'club' THEN 'members'
	ELSE 'group'
END
WHERE `kind` = 'meeting' AND `group_id` IN (SELECT `id` FROM `group`);
