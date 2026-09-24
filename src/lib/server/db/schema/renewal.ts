import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { renewalKinds } from '../../../config';

/**
 * A permit, license or insurance policy CMC itself holds (#1478, decision #1597).
 * One row per obligation, not per term: renewing moves `expiresOn` forward.
 * `expiresOn` is `YYYY-MM-DD`, a day in Corvallis with no time. The certificate
 * is a `media_attachment` in slot `certificate`, in the private bucket.
 */
export const renewal = sqliteTable(
	'renewal',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		kind: text('kind', { enum: renewalKinds }).notNull(),
		/** The city, the OLCC, the insurer. */
		issuer: text('issuer'),
		/** The permit, license or policy number. */
		reference: text('reference'),
		expiresOn: text('expires_on').notNull(),
		responsibleUserId: text('responsible_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('renewal_expires_on_idx').on(t.expiresOn)]
);

export type Renewal = typeof renewal.$inferSelect;
export type NewRenewal = typeof renewal.$inferInsert;
