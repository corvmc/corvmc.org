import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import { groupApplicationStatuses } from '../../../config';

/**
 * Somebody asking to join one `by_application` group, or several committees.
 *
 * Its own entity rather than a roster row: an application carries answers, can
 * be withdrawn, and gets a decision with a reason, and `unique(groupId, userId)`
 * on `group_member` would let nobody apply twice. Accepting one invites.
 */
export const groupApplication = sqliteTable(
	'group_application',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/**
		 * Answers keyed by `groupApplicationQuestions[kind][].id`. JSON rather than
		 * a column each, so rewording a question is not a migration.
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
	(t) => [index('idx_group_application_user').on(t.userId)]
);

/**
 * One group an application named, and what that group decided.
 *
 * The decision is here rather than on the application because a committee
 * application ticks several and each chair answers only for their own.
 */
export const groupApplicationChoice = sqliteTable(
	'group_application_choice',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		applicationId: text('application_id')
			.notNull()
			.references(() => groupApplication.id, { onDelete: 'cascade' }),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		status: text('status', { enum: groupApplicationStatuses }).notNull().default('submitted'),
		/** Why, in the reviewer's words. Shown to the applicant. */
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
		unique('group_application_choice_unique').on(t.applicationId, t.groupId),
		// The reviewer's query: this group's undecided applications.
		index('idx_group_application_choice_group_status').on(t.groupId, t.status)
	]
);
