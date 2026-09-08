<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		packingCategoryOptions,
		riderElementKindOptions,
		riderElementKindLabels,
		packingCategoryLabels,
		PACKING_MAX_ITEMS,
		PACKING_MAX_QUANTITY,
		PACKING_ITEM_NOTES_MAX
	} from '$lib/config';
	import type { PackingItemRowState } from '$lib/types/packing';
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';
	import { IconPlus, IconTrash, IconChevronUp, IconChevronDown } from '@tabler/icons-svelte';

	/**
	 * One owner's rows: what they bring, and what it becomes on a stage.
	 *
	 * Rows serialize into a single hidden JSON field — `FormData` cannot express
	 * an array of objects. **Nothing here posts a position**; the server
	 * re-derives `sortOrder` from array order, and the list's spine comes from
	 * `category`, so reordering your own rows cannot shuffle anyone else's crate.
	 */
	let {
		items = $bindable(),
		field,
		idPrefix = 'pk',
		readonly = false
	}: {
		items: PackingItemRowState[];
		/**
		 * The remote form's own `items` field. Taken from the form rather than
		 * emitted as `name="items"`: a remote form encodes its field names, so a
		 * child's plain `name` never reaches it.
		 */
		field?: RemoteFormField<RemoteFormFieldValue>;
		/**
		 * Keeps the editor-state field names apart when two editors share a page.
		 * Callers pass a slot key (`mine`, `shared`, `m0`) rather than a user id,
		 * because SvelteKit parses every submitted name as a schema path and a
		 * uuid's hyphens fail it — killing the submit client-side with no message.
		 */
		idPrefix?: string;
		readonly?: boolean;
	} = $props();

	let seq = 0;
	const rowId = () => `row-${seq++}-${Math.random().toString(36).slice(2, 8)}`;

	function addItem() {
		items = [...items, { rowId: rowId(), category: 'other', label: '', quantity: 1 }];
	}

	function removeItem(index: number) {
		items = items.filter((_, i) => i !== index);
	}

	/** Adjacent swap, the only reorder affordance this codebase has. */
	function moveItem(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= items.length) return;
		const next = [...items];
		[next[index], next[target]] = [next[target], next[index]];
		items = next;
	}

	const text = (v: string | undefined) => v?.trim() ?? '';

	/**
	 * What actually posts. Blank rows drop rather than riding as empty strings,
	 * `rowId` never leaves the browser, and `id` rides along so the server can
	 * diff instead of rebuilding — which is what keeps `packed` and the
	 * assignment alive across an edit.
	 */
	const serialized = $derived(
		JSON.stringify(
			items
				.filter((it) => text(it.label))
				.map((it) => ({
					...(it.id ? { id: it.id } : {}),
					category: it.category,
					label: text(it.label),
					quantity: it.quantity ?? 1,
					...(it.riderKind ? { riderKind: it.riderKind } : {}),
					...(text(it.notes) ? { notes: text(it.notes) } : {})
				}))
		)
	);

	const kindOptions = [{ value: '', label: 'Never goes on a stage' }, ...riderElementKindOptions];
	const filled = $derived(items.filter((it) => text(it.label)).length);
</script>

<!--
	Editor state, not form fields — only the hidden field below posts. The rows
	keep names so each `Field` label binds to its input, and those names are
	underscored because SvelteKit parses every submitted name into a schema path.
-->
{#if field && !readonly}
	<input {...field.as('hidden', serialized)} />
{/if}

<div class="space-y-3">
	{#each items as item, i (item.rowId)}
		<div class="rounded-box border border-base-300 p-3">
			<div class="grid gap-3 md:grid-cols-[1fr_8rem_1fr]">
				<Field
					name="{idPrefix}_{i}_label"
					label="What"
					bind:value={items[i].label}
					{readonly}
					placeholder="Bass rig"
				/>
				<Field
					name="{idPrefix}_{i}_qty"
					type="number"
					label="How many"
					bind:value={items[i].quantity}
					min={1}
					max={PACKING_MAX_QUANTITY}
					{readonly}
				/>
				<Field
					name="{idPrefix}_{i}_cat"
					type="select"
					label="Where it lives"
					options={packingCategoryOptions}
					bind:value={items[i].category}
					{readonly}
					display={packingCategoryLabels[item.category]}
				/>
			</div>

			<div class="mt-3 grid gap-3 md:grid-cols-2">
				<Field
					name="{idPrefix}_{i}_kind"
					type="select"
					label="On the stage plot as"
					options={kindOptions}
					bind:value={items[i].riderKind}
					{readonly}
					display={item.riderKind
						? riderElementKindLabels[item.riderKind]
						: 'Never goes on a stage'}
					description="Only for things that stand on a stage. A first-aid kit is not one."
				/>
				<Field
					name="{idPrefix}_{i}_notes"
					label="Notes"
					bind:value={items[i].notes}
					maxlength={PACKING_ITEM_NOTES_MAX}
					{readonly}
					placeholder="Lives in the blue crate"
				/>
			</div>

			{#if !readonly}
				<div class="mt-2 flex justify-end gap-1">
					<Button
						variant="ghost"
						size="xs"
						onclick={() => moveItem(i, -1)}
						disabled={i === 0}
						aria-label="Move up"
					>
						<IconChevronUp size={16} />
					</Button>
					<Button
						variant="ghost"
						size="xs"
						onclick={() => moveItem(i, 1)}
						disabled={i === items.length - 1}
						aria-label="Move down"
					>
						<IconChevronDown size={16} />
					</Button>
					<Button variant="ghost" size="xs" onclick={() => removeItem(i)} aria-label="Remove">
						<IconTrash size={16} />
					</Button>
				</div>
			{/if}
		</div>
	{:else}
		<p class="text-sm text-base-content/60">Nothing here yet.</p>
	{/each}

	{#if !readonly}
		<div class="flex items-center justify-between">
			<span class="text-xs text-base-content/60">{filled} of {PACKING_MAX_ITEMS}</span>
			<Button
				variant="ghost"
				size="sm"
				onclick={addItem}
				disabled={items.length >= PACKING_MAX_ITEMS}
			>
				<IconPlus size={16} /> Add something
			</Button>
		</div>
	{/if}
</div>
