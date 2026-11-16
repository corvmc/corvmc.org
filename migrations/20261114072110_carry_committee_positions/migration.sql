-- A committee seat title becomes a defined position (#2988): one position per
-- distinct trimmed title in each committee, held by the rows that carried it.
-- Band and club titles stay free text. Pending rows keep no holder.
INSERT INTO group_position (id, group_id, name)
SELECT lower(hex(randomblob(16))), gm.group_id, trim(gm.position)
FROM group_member gm
JOIN `group` g ON g.id = gm.group_id
WHERE g.kind = 'committee' AND gm.position IS NOT NULL AND trim(gm.position) <> ''
GROUP BY gm.group_id, trim(gm.position);
--> statement-breakpoint
INSERT INTO group_position_holder (position_id, member_id)
SELECT gp.id, gm.id
FROM group_member gm
JOIN `group` g ON g.id = gm.group_id
JOIN group_position gp ON gp.group_id = gm.group_id AND gp.name = trim(gm.position)
WHERE g.kind = 'committee' AND gm.status = 'active';
--> statement-breakpoint
UPDATE group_member SET position = NULL
WHERE position IS NOT NULL
	AND group_id IN (SELECT id FROM `group` WHERE kind = 'committee');
--> statement-breakpoint
UPDATE group_invite SET position = NULL
WHERE position IS NOT NULL
	AND group_id IN (SELECT id FROM `group` WHERE kind = 'committee');
