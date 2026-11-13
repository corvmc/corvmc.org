import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { activityKinds } from '../../../config';
import { user } from './authentication';
import { organization } from './party';
import { contact } from './contact';

/**
 * A call, meeting, email or note that staff logged about an outside party
 * (#2622), so the next committee knows what was said. Exactly one owner is set.
 * `occurred_on` is a club date (`YYYY-MM-DD`): when it happened, not when it
 * was typed in.
 */
export const activity = sqliteTable(
	'activity',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id').references(() => organization.id, {
			onDelete: 'cascade'
		}),
		contactId: text('contact_id').references(() => contact.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: activityKinds }).notNull(),
		occurredOn: text('occurred_on').notNull(),
		body: text('body').notNull(),
		authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_activity_organization')
			.on(t.organizationId, t.occurredOn)
			.where(sql`organization_id is not null`),
		index('idx_activity_contact')
			.on(t.contactId, t.occurredOn)
			.where(sql`contact_id is not null`),
		check('activity_one_owner', sql`(organization_id is null) <> (contact_id is null)`)
	]
);

export type Activity = typeof activity.$inferSelect;
