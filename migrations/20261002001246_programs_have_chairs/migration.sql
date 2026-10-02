-- Clubs and committees have no owner: their admins are the chairs (#1760). Bands keep theirs.
-- A second run is a no-op, since nothing left matches.
UPDATE group_member SET role = 'admin', updated_at = unixepoch()
WHERE role = 'owner'
	AND group_id IN (SELECT id FROM "group" WHERE kind IN ('club', 'committee'));
