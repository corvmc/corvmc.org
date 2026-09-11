<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		claimPackingItem,
		releasePackingItem,
		assignPackingItem,
		setPackingItemPacked
	} from '$lib/remote/packing.remote';
	import { packingCategoryLabels, type PackingCategory } from '$lib/config';
	import type { PackingListView } from '$lib/server/band/packing-service';
	import { IconCheck, IconPackage } from '@tabler/icons-svelte';

	/**
	 * The list as you walk it at load-out: grouped by where a thing lives, with
	 * who is bringing it and whether it is in the van.
	 *
	 * Every control here is its own `.for()` form instance, so one row's pending
	 * state cannot bleed into another's.
	 */
	let {
		bandId,
		items,
		roster,
		viewerId,
		canManage,
		isOnRoster,
		onchanged
	}: {
		bandId: string;
		items: PackingListView['items'];
		roster: { userId: string; name: string }[];
		viewerId: string;
		canManage: boolean;
		/** Claiming and ticking are roster verbs — a staff reader gets neither. */
		isOnRoster: boolean;
		onchanged: () => void;
	} = $props();

	/**
	 * Grouped by category, in the vocabulary's own order. `items` arrives already
	 * sorted by `compareItems`, so this only has to partition without disturbing
	 * it.
	 */
	const groups = $derived.by(() => {
		const out: { category: PackingCategory; rows: PackingListView['items'] }[] = [];
		for (const item of items) {
			const last = out.at(-1);
			if (last && last.category === item.category) last.rows.push(item);
			else out.push({ category: item.category, rows: [item] });
		}
		return out;
	});

	const assignOptions = $derived([
		{ value: '', label: 'Nobody yet' },
		...roster.map((m) => ({ value: m.userId, label: m.name }))
	]);
</script>

{#each groups as group (group.category)}
	<section class="mb-5">
		<h3 class="mb-2 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
			{packingCategoryLabels[group.category]}
		</h3>

		<ul class="divide-y divide-base-300 rounded-box border border-base-300">
			{#each group.rows as item (item.id)}
				<li class="flex flex-wrap items-center gap-3 p-3" class:opacity-60={item.packed}>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium" class:line-through={item.packed}>{item.label}</span>
							{#if item.quantity > 1}<Badge size="sm">×{item.quantity}</Badge>{/if}
							{#if item.packed}
								<Badge variant="success" size="sm"><IconCheck size={12} /> In the van</Badge>
							{/if}
						</div>
						<p class="mt-0.5 text-xs text-base-content/60">
							{#if item.ownerName}{item.ownerName}'s{:else}The band's{/if}
							{#if item.notes}
								· {item.notes}{/if}
							{#if item.packed && item.packedByName}
								· ticked by {item.packedByName}{/if}
						</p>
					</div>

					<!--
						Who is carrying it. "Nobody has this" is the state that loses gear,
						so it is a call to action rather than an empty cell.
					-->
					<div class="flex items-center gap-2">
						{#if item.assignedUserId}
							<Badge variant="info" size="sm">{item.assignedName}</Badge>
							{#if item.assignedUserId === viewerId}
								<Form
									remote={releasePackingItem.for(item.id)}
									guard
									successToast="Handed back"
									onsuccess={onchanged}
								>
									<input {...releasePackingItem.for(item.id).fields.bandId.as('hidden', bandId)} />
									<input {...releasePackingItem.for(item.id).fields.itemId.as('hidden', item.id)} />
									<SubmitButton label="Not me" variant="ghost" size="xs" />
								</Form>
							{/if}
						{:else if isOnRoster}
							<Form
								remote={claimPackingItem.for(item.id)}
								guard
								successToast="You're bringing it"
								onsuccess={onchanged}
							>
								<input {...claimPackingItem.for(item.id).fields.bandId.as('hidden', bandId)} />
								<input {...claimPackingItem.for(item.id).fields.itemId.as('hidden', item.id)} />
								<SubmitButton label="I'll bring it" variant="secondary" size="xs" />
							</Form>
						{:else}
							<Badge variant="warning" size="sm">Nobody has this</Badge>
						{/if}

						{#if isOnRoster}
							{@const packForm = setPackingItemPacked.for(item.id)}
							<Form
								remote={packForm}
								guard
								successToast={item.packed ? 'Taken back out' : 'In the van'}
								onsuccess={onchanged}
							>
								<input {...packForm.fields.bandId.as('hidden', bandId)} />
								<input {...packForm.fields.itemId.as('hidden', item.id)} />
								<input {...packForm.fields.packed.as('hidden', item.packed ? '0' : '1')} />
								<SubmitButton
									label={item.packed ? 'Take out' : 'Pack it'}
									variant={item.packed ? 'ghost' : 'primary'}
									size="xs"
								/>
							</Form>
						{/if}
					</div>

					{#if canManage}
						<!-- The admin path: put it on somebody, or take it off them. -->
						{@const assignForm = assignPackingItem.for(item.id)}
						<Form remote={assignForm} guard successToast="Reassigned" onsuccess={onchanged}>
							<input {...assignForm.fields.bandId.as('hidden', bandId)} />
							<input {...assignForm.fields.itemId.as('hidden', item.id)} />
							<div class="flex items-end gap-2">
								<Field
									field={assignForm.fields.toUserId}
									type="select"
									label="Assign to"
									options={assignOptions}
									value={item.assignedUserId ?? ''}
								/>
								<SubmitButton label="Set" variant="ghost" size="xs" />
							</div>
						</Form>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<div class="rounded-box border border-dashed border-base-300 p-8 text-center">
		<IconPackage size={32} class="mx-auto mb-2 text-base-content/30" />
		<p class="text-sm text-base-content/60">
			Nothing on the list yet. Add what you bring below and it shows up here.
		</p>
	</div>
{/each}
