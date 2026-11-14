-- The chair is a committee position (#3009). Every committee gets one chair
-- position, held by the rows that were its `admin` (or `owner`), and committee
-- roster rows and invites drop to `member`: the stored role no longer says who
-- chairs a committee. A position already called Chair becomes the chair.
UPDATE group_position SET is_chair = 1
WHERE name = 'Chair'
	AND group_id IN (SELECT id FROM `group` WHERE kind = 'committee');
--> statement-breakpoint
INSERT INTO group_position (id, group_id, name, is_chair)
SELECT lower(hex(randomblob(16))), g.id, 'Chair', 1
FROM `group` g
WHERE g.kind = 'committee'
	AND NOT EXISTS (SELECT 1 FROM group_position gp WHERE gp.group_id = g.id AND gp.is_chair = 1);
--> statement-breakpoint
INSERT OR IGNORE INTO group_position_holder (position_id, member_id)
SELECT gp.id, gm.id
FROM group_member gm
JOIN `group` g ON g.id = gm.group_id
JOIN group_position gp ON gp.group_id = gm.group_id AND gp.is_chair = 1
WHERE g.kind = 'committee' AND gm.status = 'active' AND gm.role IN ('owner', 'admin');
--> statement-breakpoint
UPDATE group_member SET role = 'member'
WHERE role <> 'member'
	AND group_id IN (SELECT id FROM `group` WHERE kind = 'committee');
--> statement-breakpoint
UPDATE group_invite SET role = 'member'
WHERE role <> 'member'
	AND group_id IN (SELECT id FROM `group` WHERE kind = 'committee');
