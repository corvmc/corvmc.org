-- Operations seat names move to sentence case (#3093), matching `positionLabels`.
-- Only a row still holding its seeded name is renamed, so a staff edit stands.
UPDATE group_position SET name = CASE name
	WHEN 'Technology Coordinator' THEN 'Technology coordinator'
	WHEN 'Volunteer Coordinator' THEN 'Volunteer coordinator'
	WHEN 'Site Moderator' THEN 'Site moderator'
	WHEN 'Outreach Coordinator' THEN 'Outreach coordinator'
	WHEN 'Content Editor' THEN 'Content editor'
	WHEN 'Teacher Reviewer' THEN 'Teacher reviewer'
END
WHERE group_id = 'operations' AND (id, name) IN (VALUES
	('operations-technology_coordinator', 'Technology Coordinator'),
	('operations-volunteer_coordinator', 'Volunteer Coordinator'),
	('operations-site_moderator', 'Site Moderator'),
	('operations-outreach_coordinator', 'Outreach Coordinator'),
	('operations-content_editor', 'Content Editor'),
	('operations-teacher_reviewer', 'Teacher Reviewer'));
