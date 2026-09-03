import { z } from 'zod';
import {
	packingCategories,
	riderElementKinds,
	PACKING_ITEM_NOTES_MAX,
	PACKING_LABEL_MAX,
	PACKING_MAX_ITEMS,
	PACKING_MAX_QUANTITY
} from '$lib/config';

/**
 * What a packing-list editor posts.
 *
 * Here rather than beside the tables for the reason `types/rider.ts` gives: the
 * editor component needs the types too, and a `.svelte` file cannot reach
 * `$lib/server`. `sortOrder` is absent for the same reason as well — the client
 * does not get to send an order, the service re-derives it from array position.
 */
export const packingItemDraftSchema = z.object({
	/**
	 * The row this draft replaces, when it replaces one.
	 *
	 * **A rider draft carries no id and this one does**, which is the one place
	 * the rider's precedent is deliberately broken. A rider element holds nothing
	 * but what the member typed, so deleting and reinserting an owner's rows
	 * loses nothing. A packing item holds `packed`, `assignedUserId` and
	 * `promotedAt` — state nobody typed and nobody can retype — so
	 * delete-and-reinsert would unpack a van and drop whoever agreed to carry the
	 * box, every time somebody fixed a spelling. Carrying the id lets the save be
	 * a diff instead.
	 *
	 * It is inert against forgery: every write is scoped to
	 * `(listId, ownerUserId)`, and an id outside that set is rejected rather than
	 * adopted.
	 */
	id: z.string().optional(),
	category: z.enum(packingCategories),
	label: z.string().trim().min(1, 'Every item needs a name').max(PACKING_LABEL_MAX),
	quantity: z.number().int().min(1).max(PACKING_MAX_QUANTITY).optional(),
	/** Null and absent both mean "never goes on a stage" — see `packing_item.rider_kind`. */
	riderKind: z.enum(riderElementKinds).optional(),
	notes: z.string().trim().max(PACKING_ITEM_NOTES_MAX).optional()
});

export const packingItemsDraftSchema = z
	.array(packingItemDraftSchema)
	.max(PACKING_MAX_ITEMS, `At most ${PACKING_MAX_ITEMS} things on a packing list`);

export type PackingItemDraftInput = z.infer<typeof packingItemDraftSchema>;

/**
 * One row as the editor holds it in local state: a draft plus a client-side id.
 *
 * `rowId` never reaches the server — it exists so `{#each}` can key by something
 * stable while rows are being reordered, which keying by index cannot do. It is
 * distinct from `id`, which is the server's row and is absent on a new row.
 */
export interface PackingItemRowState extends PackingItemDraftInput {
	rowId: string;
}
