import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { incidentCategories, incidentStatuses } from '../../../config';

/**
 * Something that went wrong at the venue, and what was done about it.
 *
 * `description` is written once; later facts are `incident_note` rows, so the
 * record reads the way it happened. Every user FK is `set null` with the name
 * copied beside it, because purging an account must not anonymise a report.
 * See docs/specs/incident-log-spec.md.
 */
export const incident = sqliteTable(
	'incident',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/** When it happened, which is often not when somebody wrote it down. */
		occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
		category: text('category', { enum: incidentCategories }).notNull(),
		location: text('location'),
		summary: text('summary').notNull(),
		description: text('description').notNull(),

		involvedUserId: text('involved_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		reportedByUserId: text('reported_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		reportedByName: text('reported_by_name').notNull(),

		status: text('status', { enum: incidentStatuses }).notNull().default('open'),
		resolution: text('resolution'),
		resolvedByUserId: text('resolved_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		resolvedAt: integer('resolved_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_incident_status').on(t.status, t.occurredAt),
		index('idx_incident_category').on(t.category, t.occurredAt),
		index('idx_incident_involved').on(t.involvedUserId)
	]
);

export type Incident = typeof incident.$inferSelect;

/** A follow-up under an incident. Append-only: nothing updates or deletes one. */
export const incidentNote = sqliteTable(
	'incident_note',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		incidentId: text('incident_id')
			.notNull()
			.references(() => incident.id, { onDelete: 'cascade' }),
		authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
		authorName: text('author_name').notNull(),
		body: text('body').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_incident_note_incident').on(t.incidentId, t.createdAt)]
);

export type IncidentNote = typeof incidentNote.$inferSelect;
