-- Expand step of #1624: copy every grant from the JSON columns into the join tables.
-- INSERT OR IGNORE against each table's (carrier, capability) primary key makes a
-- second run a no-op. Entries are copied as stored, allowlisted or not: the
-- resolver filters on read, exactly as it did from the JSON.
INSERT OR IGNORE INTO group_capability (group_id, capability)
SELECT g.id, j.value FROM "group" g, json_each(g.capability_grants) j
WHERE json_valid(g.capability_grants) AND j.type = 'text';
--> statement-breakpoint
INSERT OR IGNORE INTO volunteer_role_capability (volunteer_role_id, capability)
SELECT r.id, j.value FROM volunteer_role r, json_each(r.capability_grants) j
WHERE json_valid(r.capability_grants) AND j.type = 'text';
