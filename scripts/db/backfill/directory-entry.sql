-- Backfill `directory_entry` and `directory_tag` from the columns and tables
-- they take over: one entry per group, one per user, and every genre and
-- instrument folded into a single tag table.
--
-- Run AFTER the migration that creates the two tables, and BEFORE the phase-3a
-- port deploys — nothing reads them until then, so this is not urgent, only
-- ordered:
--
--   wrangler d1 execute corvmc-db --local  --file=scripts/db/backfill/directory-entry.sql
--   wrangler d1 execute corvmc-db --remote --file=scripts/db/backfill/directory-entry.sql
--
-- Not a migration, and deliberately not one: migrations here come only from
-- `pnpm db:generate`, which writes DDL from a schema diff. Splitting this into
-- create (3a) → backfill (here) → drop (3c) is what makes a mistake in the
-- mapping recoverable from columns that still exist. See
-- `scripts/db/backfill/member-standing.sql` for the same shape, and
-- docs/specs/groups-spec.md for why 3a drops nothing.
--
-- D1 has no transactions, so idempotence is the safety property instead.
-- **Every statement here is an INSERT. There is no UPDATE in this file and
-- there must never be one** — that is what makes it safe to re-run at any
-- point, forever, including after the port has deployed, to sweep up rows
-- created in the window. `scripts/db/backfill/directory-entry.spec.ts` asserts
-- it. The cost of that rule is that a subject *edited* between this run and the
-- cutover keeps its pre-edit entry; at CMC's scale that window is minutes and
-- is named in the PR rather than engineered around.
--
-- `group` is a SQL reserved word and is quoted throughout.

-- A dashed v4 uuid, because D1 has no uuid(). The whole reason entries get
-- fresh ids rather than reusing `group.id` is that a wrong id should be obvious
-- on sight, and a 32-char undashed blob sitting beside `crypto.randomUUID()`
-- output would make that harder, not easier. `randomblob()` is re-evaluated per
-- row inside INSERT … SELECT; `count(*) = count(DISTINCT id)` is the check that
-- proves it.

-- Groups. Every row today is `kind = 'band'`, but there is deliberately no kind
-- predicate: a re-run after phase 5 must pick up clubs and committees too. What
-- keeps a committee out of the band directory is the `kind` filter on the
-- listing query, not the absence of a row here.
--
-- `deleted_at` is copied rather than left null. `deactivate()` soft-deletes the
-- group, and an entry that did not follow would put a wound-up band back in the
-- public directory.
INSERT INTO directory_entry (
	id, group_id, name, bio, tagline, hometown, founded_year, avatar_key, links,
	visibility, contact, looking_for, created_at, updated_at, deleted_at
)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) ||
		'-' || hex(randomblob(6))
	),
	g.id,
	g.name,
	g.bio,
	g.tagline,
	g.hometown,
	g.founded_year,
	g.avatar_key,
	g.links,
	g.directory_visibility,
	g.directory_contact,
	CASE WHEN g.looking_for_members THEN 'members' END,
	g.created_at,
	g.updated_at,
	g.deleted_at
FROM "group" g
WHERE NOT EXISTS (SELECT 1 FROM directory_entry e WHERE e.group_id = g.id);

-- Users. `avatar_key` is deliberately not copied: a member's avatar stays
-- `user.image`, which is better-auth's column and may hold a full OAuth URL
-- rather than an R2 key.
INSERT INTO directory_entry (
	id, user_id, name, bio, tagline, hometown, links, visibility, contact,
	looking_for, available_for_hire, teaches_lessons, open_to_collaboration,
	created_at, updated_at, deleted_at
)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) ||
		'-' || hex(randomblob(6))
	),
	u.id,
	u.name,
	u.bio,
	u.tagline,
	u.hometown,
	u.links,
	u.directory_visibility,
	u.directory_contact,
	CASE WHEN u.looking_for_band THEN 'band' END,
	u.available_for_hire,
	u.teaches_lessons,
	u.open_to_collaboration,
	u.created_at,
	u.updated_at,
	u.deleted_at
FROM user u
WHERE NOT EXISTS (SELECT 1 FROM directory_entry e WHERE e.user_id = u.id);

-- The three tag folds.
--
-- `ON CONFLICT … DO NOTHING` is load-bearing rather than defensive: none of the
-- three source tables has a unique constraint, so duplicates are possible and
-- would otherwise abort the statement against `directory_tag`'s new index —
-- and with no transaction, an aborted statement leaves the table half-filled.
--
-- Values are copied verbatim. `validateTags` lowercases on save but the seed
-- does not, and SQLite's unique index is case-sensitive, so `Jazz` and `jazz`
-- both survive. Normalising them would change what the public directory
-- renders, which is its own decision and not a side effect of a migration.
--
-- `WHERE true` is not filler. SQLite cannot parse `INSERT … SELECT … ON
-- CONFLICT` without a WHERE on the SELECT: it reads the `ON` as the start of a
-- join clause and fails.
INSERT INTO directory_tag (entry_id, kind, value)
SELECT e.id, 'genre', bg.genre
FROM band_genre bg
JOIN directory_entry e ON e.group_id = bg.band_id
WHERE true
ON CONFLICT (entry_id, kind, value) DO NOTHING;

INSERT INTO directory_tag (entry_id, kind, value)
SELECT e.id, 'genre', ug.genre
FROM user_genre ug
JOIN directory_entry e ON e.user_id = ug.user_id
WHERE true
ON CONFLICT (entry_id, kind, value) DO NOTHING;

INSERT INTO directory_tag (entry_id, kind, value)
SELECT e.id, 'instrument', ui.instrument
FROM user_instrument ui
JOIN directory_entry e ON e.user_id = ui.user_id
WHERE true
ON CONFLICT (entry_id, kind, value) DO NOTHING;
