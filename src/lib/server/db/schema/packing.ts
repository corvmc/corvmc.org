import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import { packingCategories, riderElementKinds } from '../../../config';

/**
 * A band's packing list: what goes in the van, and who is bringing it.
 *
 * One list per band and durable — no event link, no per-show copy.
 * `last_reset_at` is the column this head table exists for.
 *
 * Rationale: docs/specs/shipped/packing-list-spec.md#two-tables
 */
export const packingList = sqliteTable(
	'packing_list',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),

		/**
		 * "Trailer key is in the glovebox." Not a rider note — nobody outside the
		 * band ever reads this one, which is why it is bounded well below
		 * `RIDER_NOTES_MAX`.
		 */
		notes: text('notes'),

		/**
		 * The last time somebody cleared every tick for the next load-in.
		 *
		 * A reset is the one write whose own effect destroys the evidence it
		 * happened, so without this "never packed" and "cleared an hour ago" are
		 * the same picture. See the spec's "exists for one column".
		 */
		lastResetAt: integer('last_reset_at', { mode: 'timestamp' }),
		lastResetByUserId: text('last_reset_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),

		/**
		 * Bumped by edits to **what the band brings**. A tick is not an edit and
		 * neither is a claim — see `packed` and `assigned_user_id` below.
		 */
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// In the table config rather than `.unique()` on the column: a `.unique()`
		// there emits no constraint at all on this drizzle version.
		uniqueIndex('uq_packing_list_group').on(t.groupId)
	]
);

export type PackingList = typeof packingList.$inferSelect;
export type NewPackingList = typeof packingList.$inferInsert;

/**
 * One thing that has to be in the van.
 *
 * `user_id` (whose gear) and `assigned_user_id` (who carries it) are two facts
 * and neither substitutes for the other — the band's merch tub forces both.
 * Order comes from `category`, not `sort_order`, and there is no
 * `rider_element_id`. Rationale: docs/specs/shipped/packing-list-spec.md
 */
export const packingItem = sqliteTable(
	'packing_item',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		listId: text('list_id')
			.notNull()
			.references(() => packingList.id, { onDelete: 'cascade' }),

		/** Whose it is. Null is the band's own — editable by owners and admins only. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),

		/**
		 * Who is bringing it. Null is **nobody has this** — the state that actually
		 * loses gear, and the one the load-in page leads with.
		 *
		 * A reset does not clear this: ticks are per-trip, who brings the PA is
		 * not. See the spec's "three concerns, three permission rules".
		 */
		assignedUserId: text('assigned_user_id').references(() => user.id, { onDelete: 'set null' }),
		assignedAt: integer('assigned_at', { mode: 'timestamp' }),
		/** Who put it on them. Differs from `assigned_user_id` when an admin handed it out. */
		assignedByUserId: text('assigned_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		category: text('category', { enum: packingCategories }).notNull().default('other'),

		label: text('label').notNull(),

		/** "3 × DI box". One row and a count — not three rows nobody can tell apart. */
		quantity: integer('quantity').notNull().default(1),

		/**
		 * What this is once it is on the stage, or null when it never will be.
		 * The same vocabulary the rider reads, not a parallel one: a second list
		 * meaning the same things would drift the first time either grew.
		 */
		riderKind: text('rider_kind', { enum: riderElementKinds }),

		notes: text('notes'),

		/** Tie-break within one owner's rows in one category. Dense, re-derived on save. */
		sortOrder: integer('sort_order').notNull().default(0),

		/**
		 * In the van.
		 *
		 * **Anybody on the roster may set this on any row.** Ownership governs who
		 * says what the band brings, not who may carry a box. Enforced in
		 * `setPacked` and asserted in the spec — a later reader would "fix" it
		 * back to the rider's rule.
		 */
		packed: integer('packed', { mode: 'boolean' }).notNull().default(false),
		packedAt: integer('packed_at', { mode: 'timestamp' }),
		packedByUserId: text('packed_by_user_id').references(() => user.id, { onDelete: 'set null' }),

		/**
		 * When this row was last copied onto the tech rider.
		 *
		 * **Not a foreign key, on purpose.** It records that the band made the
		 * decision; the live "is it there" answer is a label match computed on
		 * read. See the spec's "promotion stores no foreign key".
		 */
		promotedAt: integer('promoted_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_packing_item_list').on(t.listId, t.sortOrder),
		index('idx_packing_item_user').on(t.userId),
		// "My load-in" and "nobody has this" — the load-in page's two groupings.
		index('idx_packing_item_assigned').on(t.listId, t.assignedUserId),
		// The load-in page's progress count, and the filter the reset writes against.
		index('idx_packing_item_packed').on(t.listId, t.packed),
		check('packing_item_sort_nonneg', sql`sort_order >= 0`),
		// Both quantity bounds in the first migration. Adding a CHECK to a SQLite
		// table later is a full rebuild, and this one is a bound the service has to
		// enforce anyway since a client can post any number it likes — cheap now,
		// expensive later.
		check('packing_item_quantity_positive', sql`quantity >= 1`),
		check('packing_item_quantity_bounded', sql`quantity <= 99`)
	]
);

export type PackingItem = typeof packingItem.$inferSelect;
export type NewPackingItem = typeof packingItem.$inferInsert;
