import { sqliteTable, text, integer, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { groupKinds, groupJoinPolicies } from '../../../config';

/**
 * A set of CMC members who organise together — a band, a club, or a committee.
 *
 * This is the `band` table renamed, not a new one: `group.id` is `band.id`, so
 * every foreign key that pointed at a band still points at the same row. That is
 * what keeps the rest of the migration cheap — six child tables change the name
 * they reference and nothing else, and no band→group id map has to be threaded
 * through the phases that follow.
 *
 * Columns that belong elsewhere are still here and move out later: the listing
 * fields (`tagline`, `hometown`, `links`, `directoryVisibility`, …) go to
 * `directory_entry`, and the premium ones (`tier`, `subscription`, the
 * `customDomain*` set) go to `band_site`. See docs/specs/groups-spec.md.
 */
export const group = sqliteTable(
	'group',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/**
		 * Governance only — see `groupKinds`. Every existing row is a `band`, which
		 * is why that is the default: the rename has to leave twelve live bands
		 * exactly as they were.
		 */
		kind: text('kind', { enum: groupKinds }).notNull().default('band'),

		// Deliberately NOT unique. Two groups may share a name — only the slug has
		// to be distinct, and `ensureUniqueSlug` guarantees that by suffixing.
		// The old UNIQUE here made `create()` throw a raw D1 constraint error
		// (surfaced as a 500) on any duplicate name, including one still held by a
		// soft-deleted band, since `deactivate()` only sets `deletedAt`.
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		bio: text('bio'),
		avatarKey: text('avatar_key'),

		/** How the roster is joined — see `groupJoinPolicies`. Nothing reads it until the group panel lands. */
		joinPolicy: text('join_policy', { enum: groupJoinPolicies }).notNull().default('invite_only'),
		/** Prose shown beside the Join button: "third Thursday, bring a horn, charts provided". */
		joinInstructions: text('join_instructions'),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	// Index names keep their `band` prefix on purpose. SQLite carries indexes
	// through a table rename untouched, so renaming them here would turn a free
	// rename into a drop-and-recreate for no behavioural gain. They can be
	// renamed later in a migration that has a reason to touch them.
	(t) => [index('idx_band_slug').on(t.slug)]
);

export type Group = typeof group.$inferSelect;

// ---------------------------------------------------------------------------
// Roster vocabularies
// ---------------------------------------------------------------------------
// Server-only: nothing in a `.svelte` file imports these, so they stay here
// rather than moving to `config.ts`. `StatusBadge.spec.ts` does import them,
// but spec files run in the *server* vitest project — the case
// conventions.md#where-a-status-enum-lives calls out as looking inconsistent
// when it isn't.

export const groupRoles = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof groupRoles)[number];

/**
 * The three states a roster row can be in: one membership and two ways of
 * waiting to become one.
 *
 * `'requested'` is a distinct value rather than a reuse of `'pending'`, and that
 * distinction is the whole cost of `by_application`. `'pending'` means "we asked
 * you, awaiting your answer"; a request is its exact mirror. One value covering
 * both would leave every roster query unable to say which direction a waiting
 * row faces — approving an invitation you sent and approving an application you
 * received are different authorizations over identically-shaped rows.
 *
 * Adding the value emits zero SQL: this is a drizzle `text({ enum })`, a
 * TypeScript-only constraint. What it does cost is every place that *splits* a
 * roster by status, which is why `partitionByStatus` in `band-service.ts` builds
 * its buckets from this array rather than naming them.
 */
export const groupMemberStatuses = ['pending', 'active', 'requested'] as const;
export type GroupMemberStatus = (typeof groupMemberStatuses)[number];

/**
 * Membership and pending invitations in one table — every row is either an
 * invitation awaiting an answer or an active membership.
 *
 * This is `band_member` renamed, not a new table: the rows keep their identity
 * and `group_id` holds exactly what `band_id` held, because `group.id` is
 * `band.id`. Roles and membership behave identically for a band, a club and a
 * committee, which is why there is one roster rather than one per kind.
 */
export const groupMember = sqliteTable(
	'group_member',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role', { enum: groupRoles }).notNull(),
		/** Instrument or job in this group — "Bass", "Treasurer", "Chart librarian". */
		position: text('position'),
		/**
		 * A per-group stage name. Distinct from `user.name`, which is one identity
		 * across the whole platform, and from `event_band.name`, which is an act on
		 * a bill rather than a person. Null means "use the account name" — the
		 * roster falls back rather than storing a copy that goes stale the moment
		 * someone renames their account.
		 *
		 * Self-set only. An admin can say what you play; they cannot rename you.
		 */
		alias: text('alias'),
		status: text('status', { enum: groupMemberStatuses }).notNull(),
		/**
		 * The per-group announcement mute. A member of six groups needs to silence
		 * one without silencing all, which the global notification preference
		 * cannot express. Nothing reads it until announcements land in phase 7.
		 */
		notifyAnnouncements: integer('notify_announcements', { mode: 'boolean' })
			.notNull()
			.default(true),
		invitedById: text('invited_by_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		/**
		 * Nullable, unlike the `updatedAt` on every table that was born with one.
		 * SQLite rejects `ALTER TABLE … ADD COLUMN` with a non-constant default —
		 * `Cannot add a column with non-constant default` — so `(unixepoch())` is
		 * not available to a column added to a table that already has rows, and
		 * the alternatives were a hand-written backfill or stamping every existing
		 * roster row with a timestamp it did not earn. Null means "no update
		 * recorded since the phase-2 rename", which is true.
		 */
		updatedAt: integer('updated_at', { mode: 'timestamp' })
	},
	// Index and constraint names keep their `band` prefix for the same reason the
	// ones on `group` above do: SQLite carries them through `RENAME TO` untouched
	// and rewrites their column references through `RENAME COLUMN`, so renaming
	// them here would turn two free ALTERs into table rebuilds.
	(t) => [
		unique('band_member_band_user_unique').on(t.groupId, t.userId),
		index('idx_band_member_user').on(t.userId),
		index('idx_band_member_status').on(t.status),
		// This row IS the ownership as of phase 3c — `group.ownerId` held a second
		// copy that could drift, and once did: five of sixteen production bands
		// had no usable owner row behind it. The partial unique index caps a group
		// at one owner so a `transferOwnership` whose demote matched nothing
		// cannot silently produce two.
		//
		// It permits zero, deliberately. An ownerless group is legal — a program
		// whose leader stepped down and whose replacement has not been appointed —
		// which is why every query for an owner LEFT joins.
		uniqueIndex('idx_band_member_single_owner')
			.on(t.groupId)
			.where(sql`role = 'owner'`)
	]
);

/**
 * Addresses a group has released by changing its slug. An old slug redirects to
 * the group's current address only for as long as no *current* group holds it —
 * a live `group.slug` always wins, and claiming a released slug deletes its
 * history row (see `changeBandSlug`). That deletion is also why at most one row
 * can exist per slug, hence the unique index rather than a plain one.
 *
 * `onDelete: 'cascade'` is load-bearing, not decorative: `deleteBand` hard
 * deletes the group row, so without it every deletion of a group that ever
 * changed its address would fail on the foreign key.
 */
export const groupSlugHistory = sqliteTable(
	'group_slug_history',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		slug: text('slug').notNull(),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Doubles as the lookup index for the old-slug redirect, which runs on
		// every unresolved band subdomain and directory 404.
		uniqueIndex('idx_band_slug_history_slug').on(t.slug),
		index('idx_band_slug_history_band').on(t.groupId)
	]
);

export type GroupMember = typeof groupMember.$inferSelect;
export type GroupSlugHistory = typeof groupSlugHistory.$inferSelect;
