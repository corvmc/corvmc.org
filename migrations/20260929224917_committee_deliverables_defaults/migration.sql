-- A show's committee deliverables (#1701, docs/specs/committee-deliverables-spec.md §3, §6).
-- Only adds, and a second run is a no-op: roles by their unique name, the list by its unique
-- name, its items only while it has none, and grants only where missing. A committee that is
-- missing leaves its items unowned (staff's) rather than failing. Existing shows get nothing.
INSERT OR IGNORE INTO volunteer_role (id, name, "group", description, display_order, default_capacity) VALUES
	(lower(hex(randomblob(16))), 'Booking Lead', 'away-from-shows', 'Advance a show in the weeks before it: the lineup and deal, the asks to each act, and the description.', 55, 1),
	(lower(hex(randomblob(16))), 'Poster Art', 'away-from-shows', 'Make a show''s poster, working from the lineup and whatever art the acts send.', 56, 1),
	(lower(hex(randomblob(16))), 'Show Promotion', 'away-from-shows', 'Get a published show in front of people: the poster around town, social, press and the newsletter.', 56, 1),
	(lower(hex(randomblob(16))), 'Production Lead', 'away-from-shows', 'Answer for the running half of a show: the advance with the acts, the crew, the reset room and the settlement.', 56, 1);
--> statement-breakpoint
INSERT OR IGNORE INTO duty_list (id, name, description, anchor, subject, auto_apply_on)
SELECT lower(hex(randomblob(16))), 'Show deliverables',
	'What each committee owes a show, and when. Stamped onto every new show; each item is done when the fact it names is true and its tasks are ticked.',
	'start', 'event', 'production.created'
WHERE NOT EXISTS (SELECT 1 FROM duty_list WHERE auto_apply_on = 'production.created');
--> statement-breakpoint
WITH owner(key, slug, name) AS (VALUES
	('booking', 'booking-committee', 'Booking Committee'),
	('production', 'production-committee', 'Production Committee'),
	('comms', 'communications-committee', 'Communications Committee'),
	('art', 'art-and-merchandise-committee', 'Art and Merchandise Committee')
),
item(sort_order, title, owner_key, role_name, due, done_when, tasks) AS (VALUES
	(10, 'Lineup confirmed, deal agreed', 'booking', 'Booking Lead', -40320, 'production_confirmed', '[]'),
	(20, 'Act artifacts requested', 'booking', 'Booking Lead', -30240, 'artifacts_requested', '[]'),
	(30, 'Poster art made', 'art', 'Poster Art', -30240, 'poster_set', '[]'),
	(40, 'Description written', 'booking', 'Booking Lead', -30240, 'description_set', '[]'),
	(50, 'Poster distributed; announced on social, press, newsletter', 'comms', 'Show Promotion', -20160, 'event_published',
		'["Poster distributed","Announced on social","Sent to press","In the newsletter"]'),
	(60, 'Advance with the acts', 'production', 'Production Lead', -10080, 'tasks_ticked',
		'["Set times confirmed with every act","Riders and stage plots in","Backline agreed","Load-in details and door split sent"]'),
	(70, 'Crew shifts filled', 'production', 'Production Lead', -4320, 'shifts_filled', '[]'),
	(80, 'Load-out and room reset', 'production', 'Production Lead', 720, 'close_out_done', '[]'),
	(90, 'Settlement recorded', 'production', 'Production Lead', 4320, 'production_settled', '[]')
)
INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, due_offset_minutes, capacity, sort_order, tasks, title, group_id, done_when)
SELECT lower(hex(randomblob(16))), dl.id, r.id, i.due, 1, i.sort_order, i.tasks, i.title,
	COALESCE(
		(SELECT g.id FROM "group" g
		 WHERE g.kind = 'committee' AND g.deleted_at IS NULL AND g.slug = o.slug LIMIT 1),
		(SELECT g.id FROM "group" g
		 WHERE g.kind = 'committee' AND g.deleted_at IS NULL AND g.name = o.name LIMIT 1)
	),
	i.done_when
FROM item i
JOIN owner o ON o.key = i.owner_key
JOIN volunteer_role r ON r.name = i.role_name
JOIN duty_list dl ON dl.auto_apply_on = 'production.created'
WHERE NOT EXISTS (SELECT 1 FROM duty_list_item x WHERE x.duty_list_id = dl.id);
--> statement-breakpoint
-- volunteer.manageShifts, 'owned', so each committee can take, tick, resolve and hand on its own items.
WITH owner(slug, name) AS (VALUES
	('booking-committee', 'Booking Committee'),
	('production-committee', 'Production Committee'),
	('communications-committee', 'Communications Committee'),
	('art-and-merchandise-committee', 'Art and Merchandise Committee')
)
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'group', g.id, g.name,
	json_object('added', json_array('volunteer.manageShifts'), 'removed', json('[]')), unixepoch()
FROM "group" g
WHERE g.kind = 'committee'
	AND EXISTS (SELECT 1 FROM owner o WHERE g.slug = o.slug OR g.name = o.name)
	AND NOT EXISTS (
		SELECT 1 FROM group_capability c WHERE c.group_id = g.id AND c.capability = 'volunteer.manageShifts'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO group_capability (group_id, capability)
SELECT g.id, 'volunteer.manageShifts' FROM "group" g
WHERE g.kind = 'committee'
	AND (g.slug IN ('booking-committee', 'production-committee', 'communications-committee', 'art-and-merchandise-committee')
		OR g.name IN ('Booking Committee', 'Production Committee', 'Communications Committee', 'Art and Merchandise Committee'));
