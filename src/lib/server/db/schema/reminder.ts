import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * What has already been sent. One row per reminder actually delivered.
 *
 * A record of the past, never of the future: every reminder time in the app is
 * derivable from a row that already exists, and a stored future time would owe
 * every mutation path a reschedule hook. See #1186.
 */
export const reminderSent = sqliteTable(
	'reminder_sent',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/** The registry definition's key — `reservation_confirmation_final`, etc. */
		reminderKey: text('reminder_key').notNull(),

		/**
		 * What it was about. No foreign key, deliberately: the subject is a
		 * reservation, a signup or whatever comes next, and the same polymorphic
		 * bargain `financial_entry` strikes.
		 */
		subjectType: text('subject_type').notNull(),
		subjectId: text('subject_id').notNull(),

		sentAt: integer('sent_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// The whole point: the drain asks this index whether it has already sent.
		uniqueIndex('reminder_sent_once').on(t.reminderKey, t.subjectId),
		index('reminder_sent_at_idx').on(t.sentAt)
	]
);

export type ReminderSent = typeof reminderSent.$inferSelect;
