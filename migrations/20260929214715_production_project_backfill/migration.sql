-- Every production becomes a project (#1673, docs/specs/production-projects-spec.md).
-- Idempotent: each step reads only rows that are still unfilled, so a second run is a no-op.
-- A production adopts its listing's project when no other show claims it; otherwise it
-- gets a new one. The scratch table carries the pairs and is dropped at the end.
CREATE TABLE IF NOT EXISTS `_production_project_map` (
	`production_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`adopted` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `_production_project_map` (production_id, project_id, adopted)
SELECT p.id, e.project_id, 1
FROM production p
JOIN event_listing e ON e.production_id = p.id
WHERE p.project_id IS NULL
	AND e.project_id IS NOT NULL
	AND (SELECT count(*) FROM event_listing e2
		WHERE e2.project_id = e.project_id AND e2.production_id IS NOT NULL) = 1
	AND NOT EXISTS (SELECT 1 FROM production p2 WHERE p2.project_id = e.project_id);
--> statement-breakpoint
INSERT OR IGNORE INTO `_production_project_map` (production_id, project_id, adopted)
SELECT p.id,
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	0
FROM production p
WHERE p.project_id IS NULL;
--> statement-breakpoint
INSERT INTO project (id, name, status, kind, starts_at, ends_at, created_by_user_id, created_at, updated_at)
SELECT m.project_id,
	coalesce(e.title, 'Untitled show'),
	CASE
		WHEN p.status IN ('completed', 'settled', 'closed') THEN 'done'
		WHEN p.status = 'cancelled' THEN 'declined'
		ELSE 'open'
	END,
	'production',
	e.starts_at,
	CASE WHEN e.ends_at > e.starts_at THEN e.ends_at ELSE NULL END,
	p.created_by_user_id,
	p.created_at,
	unixepoch()
FROM `_production_project_map` m
JOIN production p ON p.id = m.production_id
LEFT JOIN event_listing e ON e.production_id = p.id
WHERE m.adopted = 0;
--> statement-breakpoint
UPDATE project SET kind = 'production', updated_at = unixepoch()
WHERE id IN (SELECT project_id FROM `_production_project_map` WHERE adopted = 1)
	AND kind != 'production';
--> statement-breakpoint
UPDATE production
SET project_id = (SELECT m.project_id FROM `_production_project_map` m WHERE m.production_id = production.id)
WHERE project_id IS NULL
	AND id IN (SELECT production_id FROM `_production_project_map`);
--> statement-breakpoint
-- A listing that announces a show points at that show's project.
UPDATE event_listing
SET project_id = (SELECT p.project_id FROM production p WHERE p.id = event_listing.production_id)
WHERE production_id IS NOT NULL
	AND (SELECT p.project_id FROM production p WHERE p.id = event_listing.production_id) IS NOT NULL
	AND (project_id IS NULL
		OR project_id != (SELECT p.project_id FROM production p WHERE p.id = event_listing.production_id));
--> statement-breakpoint
DROP TABLE IF EXISTS `_production_project_map`;
--> statement-breakpoint
-- The single owner becomes an `owner` row.
INSERT OR IGNORE INTO project_committee (project_id, group_id, role)
SELECT pr.id, pr.group_id, 'owner'
FROM project pr
JOIN "group" g ON g.id = pr.group_id
WHERE g.kind = 'committee';
--> statement-breakpoint
-- Every show takes Booking and Production, where those committees exist.
INSERT OR IGNORE INTO project_committee (project_id, group_id, role)
SELECT pr.id, g.id, CASE g.slug WHEN 'booking-committee' THEN 'booking' ELSE 'production' END
FROM project pr
JOIN "group" g ON g.slug IN ('booking-committee', 'production-committee')
	AND g.kind = 'committee'
	AND g.deleted_at IS NULL
WHERE pr.kind = 'production';
--> statement-breakpoint
-- A show's ledger rows count toward its project. `project_id` is a classification the
-- database already rewrites on `set null`; filling it corrects no entry.
UPDATE financial_entry
SET project_id = (SELECT p.project_id FROM production p WHERE p.id = financial_entry.subject_id)
WHERE project_id IS NULL
	AND subject_type = 'production'
	AND EXISTS (SELECT 1 FROM production p
		WHERE p.id = financial_entry.subject_id AND p.project_id IS NOT NULL);
--> statement-breakpoint
UPDATE financial_entry
SET project_id = (
	SELECT p.project_id FROM production_expense x
	JOIN production p ON p.id = x.production_id
	WHERE x.id = financial_entry.subject_id
)
WHERE project_id IS NULL
	AND subject_type = 'production_expense'
	AND EXISTS (SELECT 1 FROM production_expense x
		JOIN production p ON p.id = x.production_id
		WHERE x.id = financial_entry.subject_id AND p.project_id IS NOT NULL);
--> statement-breakpoint
UPDATE financial_entry
SET project_id = (
	SELECT p.project_id FROM event_listing e
	JOIN production p ON p.id = e.production_id
	WHERE e.id = coalesce(financial_entry.settlement_group,
		CASE WHEN json_valid(financial_entry.metadata)
			THEN json_extract(financial_entry.metadata, '$.eventId') END)
)
WHERE project_id IS NULL
	AND subject_type = 'ticket'
	AND EXISTS (
		SELECT 1 FROM event_listing e
		JOIN production p ON p.id = e.production_id
		WHERE p.project_id IS NOT NULL
			AND e.id = coalesce(financial_entry.settlement_group,
				CASE WHEN json_valid(financial_entry.metadata)
					THEN json_extract(financial_entry.metadata, '$.eventId') END)
	);
--> statement-breakpoint
-- The collective's legs of a sale name no event; the purchase's tickets do.
UPDATE financial_entry
SET project_id = (
	SELECT p.project_id FROM ticket t
	JOIN event_listing e ON e.id = t.event_id
	JOIN production p ON p.id = e.production_id
	WHERE t.purchase_id = financial_entry.subject_id AND p.project_id IS NOT NULL
	LIMIT 1
)
WHERE project_id IS NULL
	AND subject_type = 'ticket'
	AND EXISTS (
		SELECT 1 FROM ticket t
		JOIN event_listing e ON e.id = t.event_id
		JOIN production p ON p.id = e.production_id
		WHERE t.purchase_id = financial_entry.subject_id AND p.project_id IS NOT NULL
	);
--> statement-breakpoint
-- A refunded purchase's tickets may be gone; a sibling leg of the same sale still knows.
UPDATE financial_entry
SET project_id = (
	SELECT f2.project_id FROM financial_entry f2
	WHERE f2.subject_type = 'ticket' AND f2.subject_id = financial_entry.subject_id
		AND f2.project_id IS NOT NULL
	LIMIT 1
)
WHERE project_id IS NULL
	AND subject_type = 'ticket'
	AND EXISTS (
		SELECT 1 FROM financial_entry f2
		WHERE f2.subject_type = 'ticket' AND f2.subject_id = financial_entry.subject_id
			AND f2.project_id IS NOT NULL
	);
--> statement-breakpoint
-- `production.project_id` is required. Triggers rather than NOT NULL, because tightening
-- the column rebuilds `production` and its fourteen cascade children on D1.
DROP TRIGGER IF EXISTS `production_project_required_insert`;
--> statement-breakpoint
CREATE TRIGGER `production_project_required_insert`
BEFORE INSERT ON `production`
WHEN NEW.project_id IS NULL
BEGIN
	SELECT RAISE(ABORT, 'production.project_id is required');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `production_project_required_update`;
--> statement-breakpoint
CREATE TRIGGER `production_project_required_update`
BEFORE UPDATE OF `project_id` ON `production`
WHEN NEW.project_id IS NULL
BEGIN
	SELECT RAISE(ABORT, 'production.project_id is required');
END;
