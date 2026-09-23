import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { auditActions, auditSubjectTypes } from '../../../types/audit';

/**
 * Who did what to a member's account. Append-only: `recordAuditEntry` is the
 * only writer, and nothing in the app updates or deletes a row.
 *
 * The actor's name and email are copied in, and `subject_id` is not a foreign
 * key, so a row outlives both the staffer who acted and the account acted on.
 * A purge's own entry is the only record the account existed.
 */
export const auditLog = sqliteTable(
	'audit_log',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		action: text('action', { enum: auditActions }).notNull(),
		actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
		actorName: text('actor_name').notNull(),
		actorEmail: text('actor_email').notNull(),
		subjectType: text('subject_type', { enum: auditSubjectTypes }).notNull(),
		subjectId: text('subject_id').notNull(),
		subjectLabel: text('subject_label'),
		details: text('details', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('audit_log_subject_idx').on(t.subjectType, t.subjectId, t.createdAt),
		index('audit_log_actor_idx').on(t.actorUserId, t.createdAt),
		index('audit_log_created_idx').on(t.createdAt)
	]
);
