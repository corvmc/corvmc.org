import { z } from 'zod';
import {
	riderElementKinds,
	riderInputSources,
	riderProvidedBy,
	riderStandTypes,
	RIDER_ELEMENT_LABEL_MAX,
	RIDER_INPUT_LABEL_MAX,
	RIDER_ITEM_NOTES_MAX,
	RIDER_MAX_ELEMENTS,
	RIDER_MAX_INPUTS_PER_ELEMENT,
	RIDER_MIC_PREF_MAX
} from '$lib/config';

/**
 * What a rider editor posts.
 *
 * Here rather than beside the tables because the editor component needs the
 * types too, and a `.svelte` file cannot reach `$lib/server`. The shape is the
 * draft — no ids, no `sortOrder` — because **the client does not get to send an
 * order**: the service re-derives `sortOrder` from array position, the way
 * `setStaffEventLineup` does, so there is nowhere for a stale position to come
 * from.
 */
export const riderInputDraftSchema = z.object({
	label: z.string().trim().min(1, 'Every input needs a name').max(RIDER_INPUT_LABEL_MAX),
	source: z.enum(riderInputSources),
	micPref: z.string().trim().max(RIDER_MIC_PREF_MAX).optional(),
	phantom: z.boolean().optional(),
	stand: z.enum(riderStandTypes).optional(),
	monitorMixUserId: z.string().optional(),
	notes: z.string().trim().max(RIDER_ITEM_NOTES_MAX).optional()
});

export const riderElementDraftSchema = z.object({
	kind: z.enum(riderElementKinds),
	label: z.string().trim().min(1, 'Every item needs a name').max(RIDER_ELEMENT_LABEL_MAX),
	providedBy: z.enum(riderProvidedBy).optional(),
	notes: z.string().trim().max(RIDER_ITEM_NOTES_MAX).optional(),
	inputs: z
		.array(riderInputDraftSchema)
		.max(RIDER_MAX_INPUTS_PER_ELEMENT, `At most ${RIDER_MAX_INPUTS_PER_ELEMENT} inputs on one item`)
		.optional()
});

export const riderElementsDraftSchema = z
	.array(riderElementDraftSchema)
	.max(RIDER_MAX_ELEMENTS, `At most ${RIDER_MAX_ELEMENTS} items on a rider`);

export type RiderInputDraftInput = z.infer<typeof riderInputDraftSchema>;
export type RiderElementDraftInput = z.infer<typeof riderElementDraftSchema>;

/**
 * One row as the editor holds it in local state: a draft plus a client-side id.
 *
 * The id never reaches the server — it exists so `{#each}` can key by something
 * stable while rows are being reordered, which keying by index cannot do.
 */
export interface RiderElementRowState extends RiderElementDraftInput {
	rowId: string;
	inputs: (RiderInputDraftInput & { rowId: string })[];
}
