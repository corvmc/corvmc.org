import { sqliteTable, text, integer, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
	user,
	type DirectoryContact,
	type DirectoryVisibility,
	type ProfileLink
} from './authentication';
import { group } from './group';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Spelled out here rather than imported as a bare type so drizzle can constrain
 * the column, while `satisfies` keeps it from drifting from the hand-written
 * union that `user.directoryVisibility` and `group.directoryVisibility` still
 * carry until phase 3c drops them.
 */
export const directoryVisibilities = [
	'hidden',
	'members',
	'public'
] as const satisfies readonly DirectoryVisibility[];

/**
 * Two directions of one idea. `user.lookingForBand` and `group.lookingForMembers`
 * are the same question pointed opposite ways, so one nullable column carries
 * both and null means "not looking".
 */
export const lookingForValues = ['members', 'band'] as const;
export type LookingFor = (typeof lookingForValues)[number];

export const directoryTagKinds = ['genre', 'instrument'] as const;
export type DirectoryTagKind = (typeof directoryTagKinds)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * The public listing — one shape for a member, a band, and (from phase 10) an
 * external act nobody at CMC owns.
 *
 * What it is attached to is the whole of its meaning:
 *
 * | State         | Is                                                     |
 * | ------------- | ------------------------------------------------------ |
 * | `userId` set  | A member's directory presence                          |
 * | `groupId` set | A band's or group's public listing                     |
 * | Both null     | An external act — a staff-kept record, never listed    |
 * | Both set      | Illegal                                                |
 *
 * The last rule is not enforceable without a CHECK constraint and deliberately
 * stays in the service layer: violating it is odd rather than corrupting, since
 * there is still exactly one name. Two nullable typed foreign keys are not the
 * polymorphism rejected for `group_member` — both cascades are real, so deleting
 * a user takes their entry and deleting a group takes its listing.
 *
 * **Ids are fresh uuids and never reuse `group.id`.** Seeding them from the group
 * would make `entry.id == entry.groupId` true for every migrated band and false
 * for every new one, so code passing a group id where an entry id belongs would
 * work against old rows and fail only on records created later — the worst
 * failure shape available here.
 *
 * Nothing reads this table until the phase-3a port; the listing columns on
 * `user` and `group` stay authoritative until then, and are dropped in 3c. See
 * docs/specs/groups-spec.md.
 */
export const directoryEntry = sqliteTable(
	'directory_entry',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		groupId: text('group_id').references(() => group.id, { onDelete: 'cascade' }),

		/**
		 * A denormalized copy for every attached entry, and the only name an
		 * unowned external act has. `user.name` belongs to better-auth and
		 * `group.name` has readers in every module, so neither moves here — this
		 * is the `event_band.name` pattern, maintained on write.
		 *
		 * It earns the duplication: the directory's `ORDER BY name` and its search
		 * `LIKE` both run against this column rather than a joined table.
		 */
		name: text('name').notNull(),
		bio: text('bio'),
		tagline: text('tagline'),
		hometown: text('hometown'),
		foundedYear: text('founded_year'),

		/**
		 * R2 storage key, for group-attached entries only. A user-attached entry
		 * leaves this null and the member's avatar stays `user.image`: that column
		 * is better-auth's, an OAuth provider writes a full URL into it, and
		 * `setUserAvatar` carries the escape hatch that knows the difference.
		 */
		avatarKey: text('avatar_key'),
		links: text('links', { mode: 'json' }).$type<ProfileLink[] | null>(),
		visibility: text('visibility', { enum: directoryVisibilities }).notNull().default('public'),
		contact: text('contact', { mode: 'json' }).$type<DirectoryContact>(),

		lookingFor: text('looking_for', { enum: lookingForValues }),
		/**
		 * The three availability switches that travel with `lookingFor` through
		 * every filter, form and card. Columns rather than tags because they are
		 * list-query predicates, and a column compare beats an EXISTS subquery;
		 * they carry the same shape and default they had on `user`.
		 */
		availableForHire: integer('available_for_hire', { mode: 'boolean' }).notNull().default(false),
		teachesLessons: integer('teaches_lessons', { mode: 'boolean' }).notNull().default(false),
		openToCollaboration: integer('open_to_collaboration', { mode: 'boolean' })
			.notNull()
			.default(false),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		/**
		 * Carried from the subject rather than derived. A deactivated band sets
		 * `group.deletedAt`, and an entry that did not follow it would put the band
		 * back in the directory.
		 */
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	// `at most one entry per subject`, as unique indexes rather than inline
	// `.unique()` column constraints — this drizzle version silently emits
	// nothing for the latter on a nullable column. SQLite treats NULLs as
	// distinct in a unique index, so any number of unowned external acts (phase
	// 10) can sit here with both ids null. They double as the lookup indexes.
	(t) => [
		uniqueIndex('idx_directory_entry_user').on(t.userId),
		uniqueIndex('idx_directory_entry_group').on(t.groupId),
		index('idx_directory_entry_visibility').on(t.visibility)
	]
);

export type DirectoryEntry = typeof directoryEntry.$inferSelect;

/**
 * Genres and instruments in one table, replacing `band_genre`, `user_genre` and
 * `user_instrument` — three tables for two concepts, with parallel filter,
 * suggestion and write paths for each.
 *
 * `kind` is the whole of the difference, which is why the compound index leads
 * with it: `suggestGenres` and `suggestInstruments` become one range scan on
 * `(kind, value)` instead of three separate scans unioned in JS.
 */
export const directoryTag = sqliteTable(
	'directory_tag',
	{
		entryId: text('entry_id')
			.notNull()
			.references(() => directoryEntry.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: directoryTagKinds }).notNull(),
		value: text('value').notNull()
	},
	(t) => [
		// None of the three tables this replaces had a unique constraint, so the
		// backfill collapses whatever duplicates they accumulated.
		unique('directory_tag_entry_kind_value_unique').on(t.entryId, t.kind, t.value),
		index('idx_directory_tag_entry').on(t.entryId),
		index('idx_directory_tag_kind_value').on(t.kind, t.value)
	]
);

export type DirectoryTag = typeof directoryTag.$inferSelect;
