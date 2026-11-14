import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const outboxKinds = ['email', 'html_email', 'inbox_reply'] as const;
export type OutboxKind = (typeof outboxKinds)[number];

export const outboxStatuses = ['pending', 'sent', 'failed'] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

/**
 * One outgoing message, written in the same `db.batch` as the change that owes
 * it, and sent by `deliverOutbox` afterwards. A send that fails stays `pending`
 * with `last_error` set until its attempts run out, then turns `failed`.
 * docs/architecture/outbox.md has the lifecycle.
 */
export const outboxMessage = sqliteTable(
	'outbox_message',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		kind: text('kind', { enum: outboxKinds }).notNull(),
		/**
		 * `email`: recipient, template alias, model, reply-to, tag. `html_email`: recipient,
		 * subject, rendered HTML, tag. `inbox_reply`: the message id.
		 */
		payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
		/** The record this message belongs to, so its page can show whether it went. Polymorphic. */
		subjectType: text('subject_type'),
		subjectId: text('subject_id'),
		status: text('status', { enum: outboxStatuses }).notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		/** A sender holds the row until then, so the cron and an eager send never both send it. */
		claimedUntil: integer('claimed_until', { mode: 'timestamp' }),
		/** Postmark's MessageID, or the channel's, once sent. */
		providerMessageId: text('provider_message_id'),
		sentAt: integer('sent_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_outbox_message_due').on(t.status, t.nextAttemptAt),
		index('idx_outbox_message_subject').on(t.subjectType, t.subjectId)
	]
);

export type OutboxMessage = typeof outboxMessage.$inferSelect;
