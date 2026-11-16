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

/**
 * A vendor's standing tabling needs. 1:1 with an organization holding
 * `vendor`. Each market application keeps its own copy of what it asked for,
 * so editing this never changes a past market.
 */
export const vendorDetail = sqliteTable('vendor_detail', {
	organizationId: text('organization_id')
		.primaryKey()
		.references(() => organization.id, { onDelete: 'cascade' }),
	/** What they sell, in their words. */
	offering: text('offering'),
	tablesNeeded: integer('tables_needed').notNull().default(1),
	needsPower: integer('needs_power', { mode: 'boolean' }).notNull().default(false),
	bringsOwnTable: integer('brings_own_table', { mode: 'boolean' }).notNull().default(false),
	bringsTent: integer('brings_tent', { mode: 'boolean' }).notNull().default(false),
	setupNotes: text('setup_notes'),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type ContractorDetail = typeof contractorDetail.$inferSelect;
export type VendorDetail = typeof vendorDetail.$inferSelect;
