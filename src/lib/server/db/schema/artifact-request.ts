import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { eventListing } from './event';
import { directoryEntry } from './directory';
import { requestableArtifacts } from '../../../config';

/**
 * We asked someone for something, by a date.
 *
 * Only the asking. Whether it arrived is derived from the artifact itself, so a
 * rider filled in unprompted still counts and nothing has to be marked done.
 */
export const artifactRequest = sqliteTable(
	'artifact_request',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		eventId: text('event_id')
			.notNull()
			.references(() => eventListing.id, { onDelete: 'cascade' }),
		/** Who was asked. An act with no CMC account has a listing and no group. */
		entryId: text('entry_id')
			.notNull()
			.references(() => directoryEntry.id, { onDelete: 'cascade' }),

		artifact: text('artifact', { enum: requestableArtifacts }).notNull(),
		dueAt: integer('due_at', { mode: 'timestamp' }),

		requestedByUserId: text('requested_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		requestedAt: integer('requested_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		/** Withdrawn rather than deleted, so "we asked and then stopped" is legible. */
		cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// One live ask per artifact per act per show. Asking twice is a reminder,
		// not a second request, and a second row would double-count what is owed.
		uniqueIndex('uq_artifact_request_live').on(t.eventId, t.entryId, t.artifact),
		index('idx_artifact_request_event').on(t.eventId),
		index('idx_artifact_request_due').on(t.dueAt)
	]
);

export type ArtifactRequest = typeof artifactRequest.$inferSelect;
