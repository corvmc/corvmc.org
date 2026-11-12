import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { contractorTrades } from '../../../config';
import { directoryEntry } from './directory';

// ---------------------------------------------------------------------------
// Parties: every outside organization CMC deals with (#2622)
//
// Funders, sponsors and contractors were three tables with the same columns.
// They are one `organization` now, and what it is to CMC is a `party_role`
// row (in `contact.ts`, so it can reference a person too). The people at an
// organization are `contact` rows, which only `contact-service.ts` may read.
// ---------------------------------------------------------------------------

export const organization = sqliteTable(
	'organization',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		website: text('website'),
		notes: text('notes'),
		/** An act's public listing. Only performers have one. */
		directoryEntryId: text('directory_entry_id').references(() => directoryEntry.id, {
			onDelete: 'set null'
		}),
		/** Off the active lists and pickers, with every record kept. Null is live. */
		archivedAt: integer('archived_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_organization_name').on(t.name),
		uniqueIndex('idx_organization_directory_entry')
			.on(t.directoryEntryId)
			.where(sql`directory_entry_id is not null`)
	]
);

/** What only a contractor has. 1:1 with an organization holding `contractor`. */
export const contractorDetail = sqliteTable(
	'contractor_detail',
	{
		organizationId: text('organization_id')
			.primaryKey()
			.references(() => organization.id, { onDelete: 'cascade' }),
		trade: text('trade', { enum: contractorTrades }).notNull(),
		licenseNumber: text('license_number'),
		/**
		 * When their certificate of insurance runs out. A bare date and no
		 * status: current, lapsing and lapsed are readings of it. Null means we
		 * hold no certificate, which is not the same as current.
		 */
		insuranceExpiresAt: integer('insurance_expires_at', { mode: 'timestamp' }),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_contractor_detail_trade').on(t.trade)]
);

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type ContractorDetail = typeof contractorDetail.$inferSelect;
