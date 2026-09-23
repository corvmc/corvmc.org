import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { agreementKinds, agreementStatuses } from '../../../config';

/**
 * A grant or a sponsorship: a counterparty, dates that come due, and what is
 * owed afterwards. See docs/specs/development-agreements-spec.md.
 *
 * Deadlines are `YYYY-MM-DD` strings, not timestamps: a deadline is a day in
 * Corvallis with no time, so a string sorts correctly and cannot shift a day
 * across a timezone boundary.
 */
export const agreement = sqliteTable(
	'agreement',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		kind: text('kind', { enum: agreementKinds }).notNull(),
		counterparty: text('counterparty').notNull(),
		title: text('title').notNull(),
		status: text('status', { enum: agreementStatuses }).notNull().default('prospect'),
		/** Asked while prospect or applied, awarded once active. */
		amountCents: integer('amount_cents'),
		tier: text('tier'),
		contactName: text('contact_name'),
		contactEmail: text('contact_email'),
		applyBy: text('apply_by'),
		startsOn: text('starts_on'),
		endsOn: text('ends_on'),
		reportDueOn: text('report_due_on'),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('agreement_status_idx').on(t.status)]
);

export type Agreement = typeof agreement.$inferSelect;
export type NewAgreement = typeof agreement.$inferInsert;
