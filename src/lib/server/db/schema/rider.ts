import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import {
	riderElementKinds,
	riderInputSources,
	riderStandTypes,
	riderProvidedBy,
	riderMonitorFormats
} from '../../../config';

/**
 * A band's **tech rider**: what it needs on stage, kept as data rather than as
 * a PDF somebody has to open.
 *
 * The premise the shape rests on is that **a rider is not one person's
 * document**. Each member knows their own inputs and gear and nobody else's, so
 * `rider_element.userId` attributes every item to the person who can answer for
 * it, and the band's input list is the union. An owner or admin can edit
 * anyone's; that split is enforced in `rider-service.ts` and mirrors the one
 * `updateMyBandMembership` / `updateMemberRemote` already draw over
 * `group_member`.
 *
 * **Uploading a file is still a first-class path.** A band with a rider PDF it
 * already hands to every venue keeps using it — those live in the `rider` and
 * `stage_plot` `media_attachment` slots on the group, unchanged by any of this.
 * Nothing here is required, and no read surface prefers one silently over the
 * other.
 *
 * One rider per band, deliberately. A `name` column is the additive way to get
 * "full band" and "acoustic duo" variants later; nothing needs it yet.
 */
export const rider = sqliteTable(
	'rider',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),

		/**
		 * The member an engineer should call. Every rider guide asks for one by
		 * name — "the most tech-savvy member of the band" — and it is the field
		 * most often missing from the ones bands send.
		 */
		techContactUserId: text('tech_contact_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		/** Band-level, because the room supplies one monitor system. */
		monitorFormat: text('monitor_format', { enum: riderMonitorFormats }),

		/** Power, load-in, anything that is not an element. */
		notes: text('notes'),

		/**
		 * The last time a human said "this is still true".
		 *
		 * Written by nothing yet, and in the first migration on purpose. A rider
		 * is a living document that goes stale silently — the industry advice is
		 * to revise it whenever the stage, the backline, the channel count, the
		 * monitor system or the roster changes — and shows will eventually ask the
		 * band to re-confirm rather than keeping a per-show copy that drifts. This
		 * is where that lands, and retrofitting it later would mean every existing
		 * row reading "never confirmed" with no way to tell that from "confirmed
		 * before we tracked it".
		 */
		confirmedAt: integer('confirmed_at', { mode: 'timestamp' }),
		confirmedByUserId: text('confirmed_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// In the table config rather than `.unique()` on the column: a `.unique()`
		// here emits no constraint at all on this drizzle version.
		uniqueIndex('uq_rider_group').on(t.groupId)
	]
);

export type Rider = typeof rider.$inferSelect;
export type NewRider = typeof rider.$inferInsert;

/**
 * One thing that stands on the stage — an amp, a kit, a vocal position, a
 * playback laptop, a wedge.
 *
 * **Channel order comes from `kind`, not from `sortOrder`.** The convention
 * every engineer reads by is drums, bass, guitars and keys, then vocals,
 * regardless of who stands where — so a kit at stage left is still channels one
 * through six, and `riderElementKinds` is declared in exactly that order.
 * `sortOrder` breaks ties *within* a kind ("Guitar 1" before "Guitar 2").
 *
 * That split is what makes per-member editing work at all. If order were one
 * global sequence, two members saving their own corners would each renumber
 * from zero and the band's list would depend on who saved last. Deriving the
 * spine from `kind` means nobody has to coordinate, and nobody can reorder
 * somebody else's channels by rearranging their own.
 *
 * Stage position is a third, unrelated fact; `x`/`y` arrive in their own phase
 * and do not touch this column.
 *
 * `userId` is nullable because a shared playback rig belongs to nobody, and
 * `set null` rather than cascade because a member leaving the band must not
 * take the stage with them — the gear is still there, it just has no owner
 * until someone claims it.
 */
export const riderElement = sqliteTable(
	'rider_element',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		riderId: text('rider_id')
			.notNull()
			.references(() => rider.id, { onDelete: 'cascade' }),

		/** Whose it is. Null is the band's own — editable by owners and admins only. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),

		kind: text('kind', { enum: riderElementKinds }).notNull(),

		label: text('label').notNull(),

		/** `venue` is a request for CMC to supply it, not a statement of fact. */
		providedBy: text('provided_by', { enum: riderProvidedBy }).notNull().default('band'),

		notes: text('notes'),

		/** Tie-break within a kind. Dense, re-derived from array position on save. */
		sortOrder: integer('sort_order').notNull().default(0),

		/**
		 * Where it stands, as percentages of the stage — `0,0` is upstage left and
		 * `100,100` downstage right.
		 *
		 * Percentages rather than feet because a stage plot is read as a picture of
		 * relative positions, and CMC's room is not the only room these acts play.
		 * Both null means "not placed yet", which the plot renders as a tray of
		 * unplaced items rather than a pile in the corner at 0,0.
		 *
		 * **Unrelated to `sortOrder`.** Channel order is an engineer's reading
		 * order — drums, bass, guitars, vocals — and stage position is where the
		 * player physically stands. A kit at stage left is still channels one
		 * through six.
		 *
		 * No `rotation` column. A wedge that points somewhere is a real want and an
		 * additive nullable column when somebody asks for it; adding one now would
		 * be a column nothing writes, on speculation.
		 */
		x: integer('x'),
		y: integer('y'),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_rider_element_rider').on(t.riderId, t.sortOrder),
		index('idx_rider_element_user').on(t.userId),
		check('rider_element_sort_nonneg', sql`sort_order >= 0`)
		// **No range CHECK on `x`/`y`.** Adding one turns two plain ADD COLUMNs
		// into a table rebuild that takes `rider_input` with it through the FK
		// cascade — a lot of migration for a bound the service has to enforce
		// anyway, since a client can post any number it likes. `clampCoord` is
		// where the 0–100 range actually lives.
	]
);

export type RiderElement = typeof riderElement.$inferSelect;
export type NewRiderElement = typeof riderElement.$inferInsert;

/**
 * One channel the desk has to find.
 *
 * Hung off the element rather than off the rider, which does two things at
 * once: it keeps one member's edits inside one member's corner, and it lets the
 * stage plot draw a single kit where the input list shows six mics.
 *
 * **Channel numbers are not here.** They are derived by walking elements in
 * `sortOrder` and inputs within each, the same treatment `project-service.ts`
 * gives burn and `listLateOrders` gives lateness. A stored number would be
 * wrong the moment somebody adds a tom mic, and would need something to come
 * along and renumber the rest.
 */
export const riderInput = sqliteTable(
	'rider_input',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		elementId: text('element_id')
			.notNull()
			.references(() => riderElement.id, { onDelete: 'cascade' }),

		label: text('label').notNull(),

		source: text('source', { enum: riderInputSources }).notNull().default('mic'),

		/** "SM57 or similar" — a preference the house engineer may improve on. */
		micPref: text('mic_pref'),

		/** +48V. Condenser mics and active DIs need it; a dynamic mic does not. */
		phantom: integer('phantom', { mode: 'boolean' }).notNull().default(false),

		stand: text('stand', { enum: riderStandTypes }).notNull().default('none'),

		/**
		 * Whose monitor mix this feeds. Null is "no preference" rather than "no
		 * monitor" — a band that has not thought about monitors should not have
		 * that recorded as a decision.
		 */
		monitorMixUserId: text('monitor_mix_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		notes: text('notes'),

		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		index('idx_rider_input_element').on(t.elementId, t.sortOrder),
		check('rider_input_sort_nonneg', sql`sort_order >= 0`)
	]
);

export type RiderInput = typeof riderInput.$inferSelect;
export type NewRiderInput = typeof riderInput.$inferInsert;
