-- The three grant templates (#2622): one per stage, each item a task with help text in its notes.
-- Only adds, and a second run is a no-op: the role by its unique name, each list by its stage, its
-- items only while it has none. Items belong to the committee holding grant.manage (Development),
-- so the committee's task reminders reach them; with no such committee they are staff's.
INSERT OR IGNORE INTO volunteer_role (id, name, "group", description, display_order, default_capacity) VALUES
	(lower(hex(randomblob(16))), 'Grant Writer', 'away-from-shows', 'Research funders, write applications and reports, and keep each grant''s tasks moving.', 57, 1);
--> statement-breakpoint
WITH stage(grant_stage, name, anchor, description) AS (VALUES
	('application', 'Grant application', 'apply_by', 'The steps from finding a grant to submitting it, timed back from the apply-by date. Added to every new grant.'),
	('award', 'Grant award', 'award_start', 'What an award needs in its first weeks: the agreement, the reports it requires, and the project it pays for.'),
	('close_out', 'Grant close-out', 'award_end', 'The final report and the thank-you, timed from the award end.')
)
INSERT OR IGNORE INTO duty_list (id, name, description, anchor, subject, project_kind, grant_stage)
SELECT lower(hex(randomblob(16))), s.name, s.description, s.anchor, 'project', 'grant', s.grant_stage
FROM stage s
WHERE NOT EXISTS (SELECT 1 FROM duty_list d WHERE d.grant_stage = s.grant_stage);
--> statement-breakpoint
WITH item(grant_stage, sort_order, section, title, due, notes) AS (VALUES
	('application', 10, 'Application', 'Read the guidelines', -60480,
		'Read the funder''s guidelines and a few past awards. Note the deadline, the amount range, what the money may pay for, and every question the application asks.'),
	('application', 20, 'Application', 'Check eligibility', -50400,
		'Confirm CMC qualifies: nonprofit status, location, the kind of work funded, and any match required. When unsure, email the program officer; funders expect the question.'),
	('application', 30, 'Application', 'Draft the narrative', -30240,
		'Describe the need, what CMC will do, who it serves, and how you will know it worked. Answer the funder''s questions in their order, under their headings.'),
	('application', 40, 'Application', 'Build the budget', -30240,
		'List what the grant pays for, line by line, with how each figure was worked out. Show the project''s other income too, including donated goods and volunteer time.'),
	('application', 50, 'Application', 'Collect letters of support', -20160,
		'A letter of support is a short letter from a partner, venue or community member saying why the work matters and what they bring to it. Ask three weeks ahead and send them a few points to work from.'),
	('application', 60, 'Application', 'Submit the application', -1440,
		'Submit through the funder''s portal or by email. Save a copy of everything sent and the confirmation, then set the grant''s status to Applied.'),
	('award', 10, 'Award', 'Sign the grant agreement', 20160,
		'Read the agreement for its report dates, spending rules and how to credit the funder. A board officer signs it, by the funder''s date.'),
	('award', 20, 'Award', 'Add a task for each report', 20160,
		'Add one task to this project for each report the agreement requires, due on the funder''s date. Mark each one done when the report is submitted.'),
	('award', 30, 'Award', 'Set the funded project', 20160,
		'On the grant, pick the project the money pays for, so that project''s budget shows the award. Leave it empty for general operating support.'),
	('close_out', 10, 'Close-out', 'Send the thank-you letter', 20160,
		'Thank the funder in writing, with a photo or a few words from someone the work reached.'),
	('close_out', 20, 'Close-out', 'Submit the final report', 43200,
		'Report what was done, who it reached, and how the money was spent against the application''s budget. Most funders want it 30 to 60 days after the award ends; the agreement says when.')
)
INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, due_offset_minutes, capacity, sort_order, tasks, title, notes, section, group_id)
SELECT lower(hex(randomblob(16))), dl.id, r.id, i.due, 1, i.sort_order, '[]', i.title, i.notes, i.section,
	(SELECT g.id FROM "group" g
	 JOIN group_capability c ON c.group_id = g.id AND c.capability = 'grant.manage'
	 WHERE g.kind = 'committee' AND g.deleted_at IS NULL
	 ORDER BY g.slug = 'development-committee' DESC, g.name LIMIT 1)
FROM item i
JOIN duty_list dl ON dl.grant_stage = i.grant_stage
JOIN volunteer_role r ON r.name = 'Grant Writer'
WHERE NOT EXISTS (SELECT 1 FROM duty_list_item x WHERE x.duty_list_id = dl.id);
