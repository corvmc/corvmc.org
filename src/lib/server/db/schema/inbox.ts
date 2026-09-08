import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';
import { group } from './group';
import {
	inboxChannels,
	inboxThreadStatuses,
	inboxMessageDirections,
	inboxParticipantRoles
} from '../../../config';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type InboxChannel = (typeof inboxChannels)[number];
export type InboxThreadStatus = (typeof inboxThreadStatuses)[number];
export type InboxMessageDirection = (typeof inboxMessageDirections)[number];
export type InboxParticipantRole = (typeof inboxParticipantRoles)[number];

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const submitContactFormSchema = z.object({
	name: z.string().trim().min(1).max(200),
	email: z.string().trim().email().max(320),
	subject: z.string().trim().min(1).max(200),
	message: z.string().trim().min(1).max(5000),
	// Event tips, from anyone with no account. Optional and free-text on
	// purpose: a tip is a lead for a staffer to chase, not a record. They get
	// formatted into the message body in handleContactForm, so a tip is an
	// ordinary web thread in the inbox rather than a second queue to remember.
	tipEventName: z.string().trim().max(200).optional(),
	tipEventDate: z.string().trim().max(100).optional(),
	tipVenue: z.string().trim().max(200).optional(),
	tipLink: z.string().trim().max(500).optional(),
	turnstileToken: z.string().min(1)
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const inboxThread = sqliteTable(
	'inbox_thread',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		channel: text('channel', { enum: inboxChannels }).notNull(),
		/**
		 * Whose inbox this thread belongs in. **Null means CorvMC**, which is every
		 * thread that existed before band chat and every thread on every channel
		 * the collective itself corresponds on.
		 *
		 * `channel` records how a message arrived; it never said whose queue the
		 * conversation was in, because until now there was only one queue. This is
		 * the owner column `docs/architecture/domain-model.md` argued for, in the
		 * same nullable-owner shape `directory_entry` uses.
		 *
		 * Ownership and *participation* are two different questions and this is not
		 * the answer to the second one — `inbox_participant.userId` is a user FK and
		 * a group cannot be a participant. A band thread carries zero participant
		 * rows, exactly like the outward channels, which is what keeps every query
		 * in `direct-service.ts` and `portal-service.ts` correct without touching
		 * them: who may read a band thread is resolved live from the roster by
		 * `requireGroupRole`, so a new admin inherits the back catalogue and a
		 * departing one loses it. The per-reader cursor that would otherwise have
		 * lived on the participant row is `inbox_group_read` below.
		 */
		groupId: text('group_id').references(() => group.id, { onDelete: 'cascade' }),
		status: text('status', { enum: inboxThreadStatuses }).notNull().default('open'),
		subject: text('subject'),
		preview: text('preview'),
		contactName: text('contact_name'),
		contactEmail: text('contact_email'),
		contactPhone: text('contact_phone'),
		contactExternalId: text('contact_external_id'),
		assignedToUserId: text('assigned_to_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		snoozedUntil: integer('snoozed_until', { mode: 'timestamp' }),
		/**
		 * When staff last sent a reply that nobody has answered yet. Null means the
		 * ball is in our court.
		 *
		 * Deliberately not a fourth `status`: the row stays `open`, and the marker
		 * is what moves it out of the Open view and into Snoozed, beside the threads
		 * parked on a date — both are out of the queue and come back on their own.
		 * It also drops out of the staff nav badge, which counts what needs a human
		 * now. Cleared by any inbound message and by any explicit status change.
		 */
		awaitingReplySince: integer('awaiting_reply_since', { mode: 'timestamp' }),
		/**
		 * What this thread looked like before the last disposition, so the toast's
		 * Undo has something to put back.
		 *
		 * A column rather than state the client hands back: undo has to survive a
		 * reload, and a client-supplied "previous state" is an arbitrary state
		 * write wearing a hat. Written by the same UPDATE that changes the row —
		 * see `withUndoSnapshot` in thread-service — so there is no window where a
		 * thread has moved and its undo has not been recorded.
		 *
		 * Only ever holds the *dispositional* fields, and only the most recent
		 * change: undo is a ten-second correction of the action you just took, not
		 * a history. Cleared once used.
		 */
		undoState: text('undo_state', { mode: 'json' }),
		messageCount: integer('message_count').notNull().default(0),
		lastMessageAt: integer('last_message_at', { mode: 'timestamp' }),
		/**
		 * When staff last sent anything on this thread. Null means nobody here has
		 * ever answered it, which is what separates the two reasons an open thread
		 * is sitting in the queue: *unanswered* (we never replied) from *replied*
		 * (we did, and they came back). The list says which, so the pair has to be
		 * distinguishable without counting messages per row.
		 *
		 * Distinct from `awaitingReplySince`, which is cleared the moment they
		 * answer. This one only ever moves forward.
		 */
		lastOutboundAt: integer('last_outbound_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_inbox_thread_status').on(t.status),
		index('idx_inbox_thread_channel').on(t.channel),
		index('idx_inbox_thread_assigned').on(t.assignedToUserId),
		index('idx_inbox_thread_last_message').on(t.lastMessageAt),
		index('idx_inbox_thread_contact_email').on(t.contactEmail),
		index('idx_inbox_thread_contact_phone').on(t.contactPhone),
		index('idx_inbox_thread_contact_ext').on(t.channel, t.contactExternalId),
		// The band inbox's only list query: one group's threads, newest activity first.
		index('idx_inbox_thread_group').on(t.groupId, t.status, t.lastMessageAt)
	]
);

export const inboxMessage = sqliteTable(
	'inbox_message',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => inboxThread.id, { onDelete: 'cascade' }),
		direction: text('direction', { enum: inboxMessageDirections }).notNull(),
		body: text('body').notNull(),
		bodyHtml: text('body_html'),
		authorName: text('author_name'),
		authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
		channelMessageId: text('channel_message_id'),
		channelMetadata: text('channel_metadata', { mode: 'json' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_inbox_message_thread').on(t.threadId, t.createdAt),
		index('idx_inbox_message_channel_id').on(t.channelMessageId)
	]
);

export const inboxNote = sqliteTable(
	'inbox_note',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => inboxThread.id, { onDelete: 'cascade' }),
		authorUserId: text('author_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_inbox_note_thread').on(t.threadId, t.createdAt)]
);

/**
 * Who is party to a conversation, and how far each has read.
 *
 * Threads on the outward channels (email/sms/web/instagram/messenger) have no
 * participants — their contact has no account, and their identity is
 * denormalized onto the thread instead. A 'portal' thread has exactly one: the
 * member who opened it. This is a table rather than a column pair on the thread
 * so that a conversation between two signed-in people needs no schema change.
 */
export const inboxParticipant = sqliteTable(
	'inbox_participant',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => inboxThread.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role', { enum: inboxParticipantRoles }).notNull().default('member'),
		/** Read cursor for this participant. Unread ⇔ thread.lastMessageAt > lastReadAt. */
		lastReadAt: integer('last_read_at', { mode: 'timestamp' }),
		/**
		 * When this participant agreed to the conversation. Only meaningful on
		 * `direct` threads, where null means the thread is still a *request*: the
		 * person who started it is stamped at creation, the recipient stays null
		 * until they accept. Portal rows leave it null and never consult it —
		 * every query that reads this also constrains channel = 'direct'.
		 */
		acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('idx_inbox_participant_thread_user').on(t.threadId, t.userId),
		index('idx_inbox_participant_user').on(t.userId),
		index('idx_inbox_participant_user_accepted').on(t.userId, t.acceptedAt)
	]
);

/**
 * How far one person has read a group-owned thread.
 *
 * The read cursor for `portal` and `direct` lives on `inbox_participant`, and
 * for a band thread it cannot: participation there is the roster, resolved live,
 * so there is no participant row to hang it on. Writing one anyway would be
 * worse than a missing column — every member-side query in `direct-service.ts`
 * and `portal-service.ts` finds its threads by joining `inbox_participant`, so a
 * band thread with participant rows would surface in `/member/messages` for
 * every admin who had ever opened it.
 *
 * Written lazily, on first open. Unread means `thread.lastMessageAt` is newer
 * than `last_read_at`, or that there is no row at all — a thread nobody has
 * opened is unread for everybody, which is the answer a LEFT JOIN gives for
 * free.
 */
export const inboxGroupRead = sqliteTable(
	'inbox_group_read',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => inboxThread.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		lastReadAt: integer('last_read_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('idx_inbox_group_read_thread_user').on(t.threadId, t.userId),
		index('idx_inbox_group_read_user').on(t.userId)
	]
);

/**
 * Free-text labels on a conversation.
 *
 * Distinct from the inquiry type, which comes from the contact form's fixed
 * vocabulary and says what someone said they were writing about. A tag is what
 * *staff* decided this thread is, after reading it — "band", "wednesdays",
 * "chase in spring". No vocabulary, because the useful ones are not knowable in
 * advance, and no counts anywhere: these annotate a thread, they do not file it.
 */
export const inboxThreadTag = sqliteTable(
	'inbox_thread_tag',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => inboxThread.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	// Adding a tag a thread already carries is a no-op, not a second row.
	(t) => [uniqueIndex('idx_inbox_thread_tag_unique').on(t.threadId, t.tag)]
);

/**
 * A filter combination somebody wants back tomorrow.
 *
 * Per-user rather than shared: a saved view is how one person works the queue,
 * and a shared list of them would fill up with everyone else's. The filters are
 * stored as the same JSON the URL carries, so saving a view and bookmarking the
 * page are the same act with different ergonomics — and a filter added later
 * needs no migration here.
 */
export const inboxSavedView = sqliteTable(
	'inbox_saved_view',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** `{ view, channel, assigned, subject, waitingDays, q }` — all optional. */
		filters: text('filters', { mode: 'json' }).notNull().default('{}'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_inbox_saved_view_user').on(t.userId),
		// One name per person: a second "Practice space, unanswered" is a rename,
		// not a new view, and two tabs with the same label are unusable.
		uniqueIndex('idx_inbox_saved_view_user_name').on(t.userId, t.name)
	]
);

export const inboxChannelConfig = sqliteTable('inbox_channel_config', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	channel: text('channel', { enum: inboxChannels }).notNull().unique(),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
	config: text('config', { mode: 'json' }).notNull().default('{}'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type InboxThread = typeof inboxThread.$inferSelect;
export type InboxMessage = typeof inboxMessage.$inferSelect;
export type InboxNote = typeof inboxNote.$inferSelect;
export type InboxParticipant = typeof inboxParticipant.$inferSelect;
export type InboxGroupRead = typeof inboxGroupRead.$inferSelect;
export type InboxSavedView = typeof inboxSavedView.$inferSelect;
export type InboxThreadTag = typeof inboxThreadTag.$inferSelect;
