import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { workOrder } from './volunteer';
import { organization } from './party';
import { contact } from './contact';
import { inventoryAsset, inventoryItem } from './inventory';
import { reservation } from './reservation';

/**
 * What a task is about (#2622): one row per record, one nullable column per
 * kind of record, exactly one set. Real foreign keys, so deleting the record
 * deletes its links. A new kind of target is one nullable column and its index.
 *
 * A link is only "about": code that acts on a record (shift times, sign-up
 * rules, generation) keeps its own column on `work_order`.
 */
export const workOrderLink = sqliteTable(
	'work_order_link',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		workOrderId: text('work_order_id')
			.notNull()
			.references(() => workOrder.id, { onDelete: 'cascade' }),
		organizationId: text('organization_id').references(() => organization.id, {
			onDelete: 'cascade'
		}),
		contactId: text('contact_id').references(() => contact.id, { onDelete: 'cascade' }),
		assetId: text('asset_id').references(() => inventoryAsset.id, { onDelete: 'cascade' }),
		reservationId: text('reservation_id').references(() => reservation.id, {
			onDelete: 'cascade'
		}),
		// A stocked item rather than one unit of it: restock work (#2756).
		itemId: text('item_id').references(() => inventoryItem.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_work_order_link_work_order').on(t.workOrderId),
		// "Tasks about this record", one per target; unique so a task links a record once.
		uniqueIndex('idx_work_order_link_organization')
			.on(t.organizationId, t.workOrderId)
			.where(sql`organization_id is not null`),
		uniqueIndex('idx_work_order_link_contact')
			.on(t.contactId, t.workOrderId)
			.where(sql`contact_id is not null`),
		uniqueIndex('idx_work_order_link_asset')
			.on(t.assetId, t.workOrderId)
			.where(sql`asset_id is not null`),
		uniqueIndex('idx_work_order_link_reservation')
			.on(t.reservationId, t.workOrderId)
			.where(sql`reservation_id is not null`),
		uniqueIndex('idx_work_order_link_item')
			.on(t.itemId, t.workOrderId)
			.where(sql`item_id is not null`),
		check(
			'work_order_link_one_target',
			sql`(organization_id is not null) + (contact_id is not null) + (asset_id is not null) + (reservation_id is not null) + (item_id is not null) = 1`
		)
	]
);

export type WorkOrderLink = typeof workOrderLink.$inferSelect;
export type NewWorkOrderLink = typeof workOrderLink.$inferInsert;
