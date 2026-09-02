import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';
import { group } from './group';
import { directoryEntry } from './directory';
import { reservation } from './reservation';
import { recurringSeries, RECURRING_FREQUENCIES } from './recurring';

/**
 * Where a listing sits between "nobody has seen it" and "it is on the guide".
 *
 * `draft` and `pending_review` both mean not-public, but they differ in who is
 * holding it: a draft waits on its author, a pending_review row waits on staff.
 * The staff queue keys on `pending_review` alone, so members' half-written
 * drafts never land in front of a staffer.
 *
 * `cancelled` and `rejected` are both terminal and both invisible to their
 * author's edit flow, but they are opposites in public: a cancelled show WAS
 * announced and stays on the guide marked cancelled (the cancellation is the
 * announcement), while a rejected submission was never public and must never
 * become so.
 */
export const eventStatuses = [
	'draft',
	'pending_review',
	'published',
	'rejected',
	'cancelled'
] as const;
export type EventStatus = (typeof eventStatuses)[number];

/** Statuses the public gig guide and event detail pages will render. */
export const publicEventStatuses = ['published', 'cancelled'] as const;

/**
 * Who authored an event, and therefore which surface it belongs to.
 *
 * `group` is a club's or committee's session — a CMC program, held in the room,
 * and unlike a band gig it reserves that room. It is a separate value from
 * `band` rather than a reuse of it because the two differ in exactly that: a
 * band event is an off-site listing with a `location`, a group event holds the
 * space. Adding the value emits zero SQL — drizzle's `text({ enum })` is a
 * TypeScript-only constraint.
 */
export const eventSources = ['cmc', 'band', 'community', 'group'] as const;
export type EventSource = (typeof eventSources)[number];

/**
 * What kind of occasion this is, as distinct from who authored it.
 *
 * `source` answers whose listing it is; `kind` answers what it is, and both are
 * load-bearing. The hero posters and "show tonight" want CMC-authored *shows*,
 * and they got that by filtering on `source` alone — which held only while
 * every CMC event was a gig. Work parties and monthly deep cleans need
 * advertising as much as a show does, so they get listings too, and the moment
 * they do `source = 'cmc'` stops meaning "this is a show".
 *
 * Everything that existed before this column was a show, so `'show'` is both
 * the default and the backfill. Adding a value emits zero SQL — drizzle's
 * `text({ enum })` is a TypeScript-only constraint.
 */
export const eventKinds = ['show', 'work_party', 'meeting', 'class'] as const;
export type EventKind = (typeof eventKinds)[number];

export const event = sqliteTable(
	'event',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		title: text('title').notNull(),
		description: text('description'),
		startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
		// Nullable: a band backfilling old gigs rarely knows when the night ended,
		// and a member listing someone else's upcoming show usually doesn't either;
		// inventing one would bake fiction into the record. CMC events still require
		// it — enforced by the event_cmc_needs_end check below.
		endsAt: integer('ends_at', { mode: 'timestamp' }),
		doorsAt: integer('doors_at', { mode: 'timestamp' }),
		status: text('status', { enum: eventStatuses }).notNull().default('draft'),
		publishedAt: integer('published_at', { mode: 'timestamp' }),
		reservationId: text('reservation_id').references(() => reservation.id),
		posterKey: text('poster_key'),
		tags: text('tags'),
		ticketingEnabled: integer('ticketing_enabled', { mode: 'boolean' }).notNull().default(false),
		ticketPrice: integer('ticket_price'),
		ticketQuantity: integer('ticket_quantity'),
		// The group that OWNS this event — whose panel or page it lives in, and the
		// only group that may edit, publish or cancel it. Null for CMC-produced
		// events. This is authority, not billing, and it is not the bill either:
		// who actually played is `event_band`, and every write that sets `groupId`
		// on a band event must also write the matching confirmed `event_band` row.
		//
		// Which groups *advertise* the event is `event_group` — a different
		// question, and one that can have several answers.
		groupId: text('group_id').references(() => group.id, { onDelete: 'set null' }),
		source: text('source', { enum: eventSources }).notNull().default('cmc'),
		kind: text('kind', { enum: eventKinds }).notNull().default('show'),
		location: text('location'),
		externalTicketUrl: text('external_ticket_url'),
		recurringSeriesId: text('recurring_series_id').references(() => recurringSeries.id, {
			onDelete: 'set null'
		}),
		// Why staff turned a community listing down, or pulled it off the guide.
		// Stored rather than only emailed because `rejected` exists so the member
		// can fix and resubmit — and they can't fix what they can't see. Mirrors
		// volunteer_hour_log.reviewNotes. Null on everything staff produce
		// themselves; nothing outside the community review flow writes it.
		reviewNotes: text('review_notes'),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_event_status_starts').on(t.status, t.startsAt),
		index('idx_event_reservation').on(t.reservationId),
		index('idx_event_band').on(t.groupId),
		index('idx_event_source').on(t.source, t.status, t.startsAt),
		index('idx_event_recurring_series').on(t.recurringSeriesId),
		uniqueIndex('uq_event_recurring_instance')
			.on(t.recurringSeriesId, t.startsAt)
			.where(sql`recurring_series_id IS NOT NULL AND status != 'cancelled'`),
		// Passes when ends_at is NULL: `NULL > x` is NULL, and a CHECK passes on NULL.
		check('event_time_order', sql`ends_at > starts_at`),
		// Only CMC events must know when they end — they hold the room. Nobody
		// remembers when a 2019 gig finished, and a member posting someone else's
		// upcoming show usually doesn't know either.
		check('event_cmc_needs_end', sql`source != 'cmc' OR ends_at IS NOT NULL`)
	]
);

// ---------------------------------------------------------------------------
// Event lineup (the bill)
// ---------------------------------------------------------------------------

/**
 * Where a lineup row sits between "just a credit" and "a link to a real band".
 *
 * Invariant: `unlinked` ⇔ `directoryEntryId IS NULL`. Everything else has one.
 *
 * `unlinked` keeps its exact meaning through the phase-10 re-key: a name with no
 * record behind it, which is the common case and the whole of backfilled
 * history. Staff stubbing an act when they book it is what creates the record
 * and points the row at it.
 *
 * - unlinked  — a name with no account behind it. The common case: most acts on
 *               a bill, especially in backfilled history, aren't CMC members.
 * - pending   — points at a platform band that hasn't agreed yet.
 * - confirmed — the act agreed. Only these reach that party's own profile.
 *
 *               A row pointing at an **external act** — an entry with no user
 *               and no group — is `confirmed` by construction. `pending` models
 *               a party *agreeing* to be listed, which presumes somebody with an
 *               account to agree; an unowned entry has nobody, staff entered it,
 *               and there is no consent step to wait on.
 * - declined  — the act said no. Keeps its `directoryEntryId` so the partial
 *               unique index below blocks the owner from re-adding and
 *               re-pinging them; it renders exactly like an unlinked credit.
 */
export const eventBandStatuses = ['unlinked', 'pending', 'confirmed', 'declined'] as const;
export type EventBandStatus = (typeof eventBandStatuses)[number];

/**
 * Who played, as opposed to who manages the record (that is `event.groupId`).
 *
 * A row is always a *name*; the band link is optional. That split is the whole
 * point — listing an off-platform band must not require an account, and listing
 * a platform band must not write to that band's profile without their consent.
 *
 * Rendering splits by direction:
 *   on the event    — every row shows, but only `confirmed` links to the band
 *   on B's profile  — only `confirmed` appears at all
 */
export const eventBand = sqliteTable(
	'event_band',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		/** Display credit. Always set, even when the entry link is. */
		name: text('name').notNull(),
		/**
		 * The party this credit names — a member, a CMC band, or an external act.
		 *
		 * `event_band` is a credit on one bill: a display name, a billing order, a
		 * consent status, and nothing about the act beyond how it appeared that
		 * night. A `directory_entry` is the persistent record of a party, reusable
		 * across every event they ever play. Pointing at the entry rather than at a
		 * group is what lets a lineup mix bands, solo members and external acts
		 * uniformly — no fake band row, and no slug for an act that has no CMC page.
		 *
		 * "Which CMC band is this?" is now `directory_entry.groupId`, one join away.
		 * That is the point rather than a cost: an external act has no group, and
		 * the join returning null is the same fact as "there is no CMC page to link
		 * to".
		 *
		 * `cascade` is what the column it replaced did. It is arguably wrong — a
		 * credit is a fact about a night and could outlive the record of the
		 * party — but changing it is a behaviour change rather than a re-key, so
		 * it stays as it was.
		 */
		directoryEntryId: text('directory_entry_id').references(() => directoryEntry.id, {
			onDelete: 'cascade'
		}),
		/** 0 = headliner, ascending down the bill. */
		billingOrder: integer('billing_order').notNull().default(0),
		status: text('status', { enum: eventBandStatuses }).notNull().default('unlinked'),
		/** Optional slot label, e.g. "Direct support". */
		note: text('note'),
		/**
		 * Which group put this credit on the bill — an act of authority, so it
		 * names the group rather than the party's entry. Null once that group is
		 * gone; who added a credit is history, not a live reference.
		 */
		addedByGroupId: text('added_by_group_id').references(() => group.id, {
			onDelete: 'set null'
		}),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Partial: many unlinked credits per event are fine, but a given party can
		// only appear once — which is also what makes `declined` stick.
		//
		// Both keep their old names. SQLite carries an index through a table
		// rebuild only if it is recreated, and these are recreated by the
		// migration; the names stay so the diff is about the column rather than
		// about renaming things that already worked.
		uniqueIndex('uq_event_band_event_band')
			.on(t.eventId, t.directoryEntryId)
			.where(sql`directory_entry_id IS NOT NULL`),
		index('idx_event_band_band_status').on(t.directoryEntryId, t.status),
		index('idx_event_band_event_order').on(t.eventId, t.billingOrder)
	]
);

export type EventBand = typeof eventBand.$inferSelect;

/**
 * Which groups' pages an event appears on — **reach**, not credit.
 *
 * Three tables describe "who else is on this event" and they do not overlap:
 *
 * | Table             | Models                            | Carries                          |
 * | ----------------- | --------------------------------- | -------------------------------- |
 * | `production_slot` | the run of show for a CMC show    | set times, lengths, settlement   |
 * | `event_band`      | who played — a credit on the bill | display name, billing, consent   |
 * | `event_group`     | shared advertising                | which pages show it, in what order |
 *
 * `event_band` answers "whose name is on the poster"; this answers "whose page
 * does this appear on". A co-hosted show plausibly writes both, and that is
 * fine — they are different facts about one event, not two encodings of one.
 *
 * The managing group (`event.groupId`) is inserted here as the first row
 * automatically, so no read path needs a "sometimes present, sometimes not"
 * branch.
 */
export const eventGroup = sqliteTable(
	'event_group',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		/** 0 = the managing group, ascending for co-hosts. */
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('uq_event_group_event_group').on(t.eventId, t.groupId),
		index('idx_event_group_group').on(t.groupId, t.sortOrder)
	]
);

export type EventGroup = typeof eventGroup.$inferSelect;

/** One act on the bill, as submitted by a lineup editor. */
export const lineupEntrySchema = z.object({
	name: z.string().trim().min(1, 'Name is required').max(200),
	bandId: z.string().optional(),
	billingOrder: z.number().int().min(0).max(11),
	note: z.string().max(100).optional()
});

/** A whole bill. Capped so one event can't fan out unbounded invites. */
export const lineupSchema = z.array(lineupEntrySchema).max(12, 'At most 12 acts on a bill');

export type LineupEntry = z.infer<typeof lineupEntrySchema>;

// ---------------------------------------------------------------------------
// Community submission standing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Form schemas
// ---------------------------------------------------------------------------

export const createEventSchema = z
	.object({
		title: z.string().min(1, 'Title is required'),
		description: z.string().optional(),
		kind: z.enum(eventKinds).default('show'),
		eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
		eventStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
		eventEndTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
		doorsTime: z.string().optional(),
		tags: z.string().optional(),
		ticketingEnabled: z.boolean().default(false),
		ticketPrice: z.string().optional(),
		ticketQuantity: z.string().optional(),
		reserveSpace: z.boolean().default(false),
		reservationStartTime: z.string().optional(),
		reservationEndTime: z.string().optional(),
		overrideConflicts: z.boolean().default(false),
		recurring: z.boolean().default(false),
		recurringFrequency: z.enum(RECURRING_FREQUENCIES).optional(),
		monthlyMode: z.enum(['weekday', 'monthday']).optional(),
		// Allow empty (unset) or a YYYY-MM-DD date; empty is normalized in the handler.
		recurringEndsAt: z
			.string()
			.regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
			.optional()
	})
	.superRefine((data, ctx) => {
		// Ticketing requires a positive price. Surfacing this here turns what would
		// otherwise be a thrown Error in the event service (→ 500 "Internal Error")
		// into a graceful form validation failure.
		if (data.ticketingEnabled) {
			const cents = data.ticketPrice ? parseInt(data.ticketPrice, 10) : NaN;
			if (!Number.isFinite(cents) || cents <= 0) {
				ctx.addIssue({
					code: 'custom',
					path: ['ticketPrice'],
					message: 'Ticket price is required when ticketing is enabled'
				});
			}
		}

		// A recurring series needs a frequency to expand.
		if (data.recurring && !data.recurringFrequency) {
			ctx.addIssue({
				code: 'custom',
				path: ['recurringFrequency'],
				message: 'Choose how often the event repeats'
			});
		}
	});

/**
 * The fields a member fills in for a community listing.
 *
 * Deliberately missing `ticketingEnabled`: CMC never sells a listing it doesn't
 * produce, so the flag is unreachable from this shape the same way it is from
 * `CreateBandEventParams`. A door/off-site `ticketPrice` and an
 * `externalTicketUrl` are both fine — they describe where someone else sells.
 *
 * Remotes extend this with `posterFile` and (on edit) an `id`.
 */
export const communityEventSchema = z.object({
	title: z.string().trim().min(1, 'Title is required').max(200),
	description: z.string().max(5000).optional(),
	eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
	eventStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
	// Optional for the same reason it is on band gigs: whoever is posting this
	// often has no idea when the night ends.
	eventEndTime: z
		.string()
		.regex(/^$|^\d{2}:\d{2}$/, 'Invalid time')
		.optional(),
	doorsTime: z
		.string()
		.regex(/^$|^\d{2}:\d{2}$/, 'Invalid time')
		.optional(),
	location: z.string().max(500).optional(),
	tags: z.string().max(500).optional(),
	externalTicketUrl: z.string().url('Enter a full URL').optional().or(z.literal('')),
	ticketPriceDollars: z.string().max(12).optional(),
	/** Hidden JSON field written by LineupEditor. */
	lineup: z.string().optional()
});

export type CommunityEventInput = z.infer<typeof communityEventSchema>;

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type Event = typeof event.$inferSelect;
