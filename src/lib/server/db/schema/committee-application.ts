import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import { committeeApplicationStatuses } from '../../../config';

/**
 * Somebody asking to join one or more committees.
 *
 * **Its own entity rather than `group_member.status = 'requested'`**: that row
 * is designed to carry no content, which is why `declineApplication()` deletes
 * it, and `unique(groupId, userId)` would let nobody apply twice.
 */
// Membership stays the outcome. Committees remain `invite_only`; accepting an
// application invites, and the roster goes on meaning who is on the committee.
export const committeeApplication = sqliteTable(
	'committee_application',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/**
		 * Answers keyed by `committeeApplicationQuestions[].id`.
		 *
		 * JSON rather than a column each: the questions are board policy and the
		 * board rewords them, which should not be a migration. Keying by id keeps
		 * an old answer readable after a prompt changes.
		 */
		answers: text('answers', { mode: 'json' })
			.$type<Record<string, string>>()
			.notNull()
			.default(sql`'{}'`),
		/** Set when the applicant pulls the whole application, before any decision. */
		withdrawnAt: integer('withdrawn_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_committee_application_user').on(t.userId)]
);

/**
 * One committee an application named, and what that committee decided.
 *
 * The decision is here rather than on the application because the paper form
 * ticks several boxes and each chair answers only for their own: Booking
 * accepting you says nothing about what Facility did.
 */
export const committeeApplicationChoice = sqliteTable(
	'committee_application_choice',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		applicationId: text('application_id')
			.notNull()
			.references(() => committeeApplication.id, { onDelete: 'cascade' }),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		status: text('status', { enum: committeeApplicationStatuses }).notNull().default('submitted'),
		/**
		 * Why, in the chair's words. Stored rather than only emailed, following
		 * `event.reviewNotes`, `volunteer_hour_log.reviewNotes` and
		 * `instructor.reviewNotes` — a decision the applicant cannot see is one
		 * nobody can answer a question about later.
		 */
		reviewNotes: text('review_notes'),
		decidedByUserId: text('decided_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		decidedAt: integer('decided_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// One committee cannot appear twice in one application.
		unique('committee_application_choice_unique').on(t.applicationId, t.groupId),
		// The chair's query: this committee's undecided applications.
		index('idx_committee_choice_group_status').on(t.groupId, t.status)
	]
);
