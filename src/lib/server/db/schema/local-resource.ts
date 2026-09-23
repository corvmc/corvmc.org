import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { localResourceStatuses } from '../../../config';

/**
 * A staff-managed vocabulary for the local resources directory, shaped like
 * `equipment_category`: a label with an order. docs/specs/local-resources-spec.md
 */
export const localResourceCategory = sqliteTable('local_resource_category', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull().unique(),
	displayOrder: integer('display_order').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

export type LocalResourceCategory = typeof localResourceCategory.$inferSelect;

/**
 * A music business or service the collective points the community at. Its
 * contact fields are public by design and live here — never in `contact`,
 * which is the private, staff-only half of a party record.
 */
export const localResource = sqliteTable(
	'local_resource',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		// Restrict: deleting a category that still has listings must fail, not
		// take the listings with it.
		categoryId: text('category_id')
			.notNull()
			.references(() => localResourceCategory.id, { onDelete: 'restrict' }),
		name: text('name').notNull(),
		description: text('description'),
		website: text('website'),
		phone: text('phone'),
		addressLine: text('address_line'),
		status: text('status', { enum: localResourceStatuses }).notNull().default('pending'),
		submittedByUserId: text('submitted_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		submitterEmail: text('submitter_email'),
		/** Why it was rejected — shown back to the submitter. */
		staffNote: text('staff_note'),
		reviewedByUserId: text('reviewed_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
		displayOrder: integer('display_order').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(t) => [
		index('idx_local_resource_public').on(t.status, t.categoryId),
		index('idx_local_resource_status').on(t.status)
	]
);

export type LocalResource = typeof localResource.$inferSelect;
