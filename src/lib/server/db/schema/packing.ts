import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import { packingCategories, riderElementKinds } from '../../../config';

/**
 * A band's **packing list**: what goes in the van, kept as a list the band can
 * tick rather than as the thing everybody actually uses, which is memory.
 *
 * This is the tech rider asked the other way round. A rider asks "what does the
 * desk have to find?", which is a question only a band that has played out can
 * answer; a packing list asks "what do you bring to a gig?", which a band can
 * answer on the day it forms. So this is the friendlier door into the same
 * room — and the reason `rider_kind` exists on the item below is that walking
 * through it should furnish the rider on the way.
 *
 * **The ownership model is the rider's, deliberately and exactly.**
 * `packing_item.user_id` attributes every row to the person who can answer for
 * it, null is the band's own shared stuff, and `set null` on delete because a
 * member leaving does not take the merch tub with them. `saveOwnItems` and
 * `saveItemsFor` in `packing-service.ts` draw the same line
 * `saveOwnElements`/`saveElementsFor` do, for the reason written there.
 *
 * **One list per band, and it is durable.** There is no event link and no
 * per-show copy. A band packs the same crate every time; a list that had to be
 * created per show would be a list nobody created. `last_reset_at` is what
 * makes one reusable list work — see below.
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
		 * This is the column the head table exists for. A reset is the one write
		 * whose own effect destroys the evidence it happened — after it, every
		 * flag reads false and "never packed" and "packed, then cleared an hour
		 * ago" are the same picture. The load-in page leads with this, because a
		 * list that has not been reset since March is a list that is lying about
		 * a van somebody is standing next to.
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
 * **`user_id` and `assigned_user_id` are two different facts and neither
 * substitutes for the other.** `user_id` is whose gear it is, and it is what
 * promotion writes onto the rider; `assigned_user_id` is who is carrying it.
 * The case that forces two columns is the band's own merch tub: nobody owns it,
 * somebody has to bring it, and collapsing the pair would put the tub on the
 * rider as that person's stage gear. Say it as *the rider cares whose amp it
 * is; the van cares who is carrying it.* They agree on most rows, which is
 * exactly why somebody will eventually try to merge them.
 *
 * A member leaving nulls both. The gear is still there and the job is still
 * open — which is what the unassigned count should then show.
 *
 * **Grouping order comes from `category`, not from `sort_order`** — the same
 * split, for the same reason, that makes `rider_element` read by `kind`. If
 * order were one global sequence, two members saving their own rows would each
 * renumber from zero and the band's list would depend on who saved last.
 * Deriving the spine from the vocabulary means nobody coordinates, and nobody
 * can shuffle somebody else's crate by reordering their own. `sort_order`
 * breaks ties *within* one owner's rows in one category.
 *
 * **`packed` lives here, on the row, and it is not a second table.** One
 * durable list per band with a flag on each row is the whole check-off design:
 * you tick as you load, and "reset for the next load-in" clears the column. A
 * join table keyed on a show would be a per-show instance, which is the thing
 * this feature is deliberately not.
 *
 * A tick therefore **does not touch `packing_list.updated_at`**, and neither
 * does a claim. That column means "what we bring changed"; packing the amp you
 * always bring changes nothing about the list. Keeping them apart is also what
 * lets the editor's `{#key}` remount survive somebody else ticking a box on
 * their phone mid-edit.
 *
 * **`rider_kind` is the bridge, and it is nullable on purpose.** A row with a
 * kind is a thing that stands on a stage and can be promoted into a
 * `rider_element`; a first-aid kit and a box of shirts are neither. Null is the
 * common case and must not read as unfinished.
 *
 * **There is no `rider_element_id`.** See `promoteOwnItems` in
 * `packing-service.ts` for the argument — the short version is that the rider's
 * own save deletes and reinserts an owner's elements, so any id stored here
 * would be stale by the next rider edit, silently.
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
		 * Who is bringing it. Null is **nobody has this**, which is the state that
		 * actually loses gear and the one the load-in page leads with.
		 *
		 * A member claims an unassigned row for themselves and releases their own;
		 * an owner or admin assigns or reassigns anyone. That split is three
		 * service functions rather than one taking a user id, for the reason
		 * `rider.remote.ts` gives about `saveMyRiderElements`: `claimItem` takes no
		 * assignee at all, so no code path exists by which a member could put a row
		 * on somebody else.
		 *
		 * **A reset does not clear this.** Ticks are per-trip; who brings the PA is
		 * not, and re-negotiating the load-in every show is the coordination this
		 * feature exists to remove.
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
		 * **Anybody on the roster may set this on any row**, which is one of two
		 * places this table departs from the rider's permission model (the other
		 * is claiming). Ownership governs who may say what the band brings; it
		 * does not govern who may carry a box. One person walks the list at
		 * load-out and it is not always an admin, and the bassist who stows the
		 * shared PA tub must be able to say so. Enforced in `setPacked`, and
		 * asserted in the spec, because it is a rule a later reader would "fix"
		 * back to the rider's.
		 */
		packed: integer('packed', { mode: 'boolean' }).notNull().default(false),
		packedAt: integer('packed_at', { mode: 'timestamp' }),
		packedByUserId: text('packed_by_user_id').references(() => user.id, { onDelete: 'set null' }),

		/**
		 * When this row was last copied onto the tech rider.
		 *
		 * **Not a foreign key, on purpose** — see the table comment. It records
		 * that the band made the decision, which is a different fact from whether
		 * a matching element is on the rider right now: an element the band
		 * promoted and then deliberately deleted must not come back as a
		 * suggestion every time this page loads. The live "is it there" answer is
		 * a label match computed on read.
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
