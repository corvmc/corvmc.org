<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { promotePackingItems } from '#lib/remote/packing.remote.js';
	import { riderElementKindLabels } from '#lib/config.js';
	import type { PackingListView } from '#lib/server/band/packing-service.js';
	import { IconArrowUpRight } from '@tabler/icons-svelte';

	/**
	 * Your own gear that stands on a stage and is not on the rider yet.
	 *
	 * Walking through the easy door furnishes the rider on the way — the whole
	 * reason `packing_item.rider_kind` exists. A row the band promoted and then
	 * deleted is filtered out by `promotedAt`, never by `onRider`, so a
	 * deliberate deletion is not re-suggested on every load.
	 */
	let {
		bandId,
		items,
		viewerId,
		onpromoted
	}: {
		bandId: string;
		items: PackingListView['items'];
		viewerId: string;
		onpromoted: () => void;
	} = $props();

	const candidates = $derived(
		items.filter((i) => i.userId === viewerId && i.riderKind && !i.onRider && !i.promotedAt)
	);
</script>

{#snippet icon()}
	<IconArrowUpRight size={14} />
{/snippet}

{#if candidates.length > 0}
	<Card class="mb-6">
		<CardBody>
			<h2 class="text-base font-semibold">
				{m.band_slug_packing_promote_to_rider_some_belongs_rider_title()}
			</h2>
			<p class="mt-0.5 mb-3 text-xs text-base-content/60">
				{m.band_slug_packing_promote_to_rider_bring_these_they_stand_st_text()}
			</p>

			<ul class="divide-y divide-base-300 rounded-box border border-base-300">
				{#each candidates as item (item.id)}
					{@const promoteForm = promotePackingItems.for(item.id)}
					<li class="flex flex-wrap items-center gap-3 p-3">
						<div class="min-w-0 flex-1">
							<span class="font-medium">{item.label}</span>
							{#if item.riderKind}
								<Badge size="sm" class="ml-2">{riderElementKindLabels[item.riderKind]}</Badge>
							{/if}
						</div>

						<Form
							remote={promoteForm}
							guard
							successToast={m.band_slug_packing_promote_to_rider_success_toast()}
							onsuccess={onpromoted}
						>
							<input {...promoteForm.fields.bandId.as('hidden', bandId)} />
							<input {...promoteForm.fields.itemIds.as('hidden', item.id)} />
							<SubmitButton
								label={m.band_slug_packing_promote_to_rider_label()}
								variant="secondary"
								size="xs"
								{icon}
							/>
						</Form>
					</li>
				{/each}
			</ul>
		</CardBody>
	</Card>
{/if}
