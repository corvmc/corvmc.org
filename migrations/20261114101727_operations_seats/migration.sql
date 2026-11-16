-- Job positions move into Operations (#2992). The Operations committee gets one
-- position per job, and every job held through `model_has_roles` becomes an
-- active Operations membership holding that position. `admin` stays a role row.
-- `operations-rows.ts` is the seed's copy of these rows.
INSERT OR IGNORE INTO `group` (id, kind, name, slug, join_policy)
VALUES ('operations', 'committee', 'Operations', 'operations', 'invite_only');
--> statement-breakpoint
INSERT OR IGNORE INTO directory_entry (id, group_id, name, visibility)
VALUES ('operations', 'operations', 'Operations', 'members');
--> statement-breakpoint
INSERT OR IGNORE INTO group_position (id, group_id, name, is_chair, job) VALUES
	('operations-staff', 'operations', 'Staff', 0, 'staff'),
	('operations-operations_chair', 'operations', 'Chair', 1, 'operations_chair'),
	('operations-technology_coordinator', 'operations', 'Technology Coordinator', 0, 'technology_coordinator'),
	('operations-volunteer_coordinator', 'operations', 'Volunteer Coordinator', 0, 'volunteer_coordinator'),
	('operations-site_moderator', 'operations', 'Site Moderator', 0, 'site_moderator'),
	('operations-treasurer', 'operations', 'Treasurer', 0, 'treasurer'),
	('operations-outreach_coordinator', 'operations', 'Outreach Coordinator', 0, 'outreach_coordinator'),
	('operations-content_editor', 'operations', 'Content Editor', 0, 'content_editor'),
	('operations-teacher_reviewer', 'operations', 'Teacher Reviewer', 0, 'teacher_reviewer'),
	('operations-auditor', 'operations', 'Auditor', 0, 'auditor');
--> statement-breakpoint
INSERT OR IGNORE INTO group_member (id, group_id, user_id, role, status)
SELECT lower(hex(randomblob(16))), 'operations', m.user_id, 'member', 'active'
FROM model_has_roles m
JOIN roles r ON r.id = m.role_id
JOIN group_position gp ON gp.group_id = 'operations' AND gp.job = r.name
GROUP BY m.user_id;
--> statement-breakpoint
UPDATE group_member SET status = 'active'
WHERE group_id = 'operations' AND user_id IN (
	SELECT m.user_id FROM model_has_roles m
	JOIN roles r ON r.id = m.role_id
	JOIN group_position gp ON gp.group_id = 'operations' AND gp.job = r.name
);
--> statement-breakpoint
INSERT OR IGNORE INTO group_position_holder (position_id, member_id)
SELECT gp.id, gm.id
FROM model_has_roles m
JOIN roles r ON r.id = m.role_id
JOIN group_position gp ON gp.group_id = 'operations' AND gp.job = r.name
JOIN group_member gm ON gm.group_id = 'operations' AND gm.user_id = m.user_id;
--> statement-breakpoint
DELETE FROM model_has_roles WHERE role_id IN (
	SELECT r.id FROM roles r
	JOIN group_position gp ON gp.group_id = 'operations' AND gp.job = r.name
);
--> statement-breakpoint
DELETE FROM roles WHERE name IN (
	SELECT job FROM group_position WHERE group_id = 'operations' AND job IS NOT NULL
);
