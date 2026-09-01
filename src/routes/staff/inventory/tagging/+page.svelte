<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { getUntaggedAssets, bindTag } from '$lib/remote/inventory.remote';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';

	/**
	 * Everything waiting for a sticker.
	 *
	 * The queue is derived, never stored — it is exactly `asset_tag IS NULL`, so
	 * binding a tag removes a row with nothing to keep in sync. It exists because
	 * entering gear and labelling it are two different jobs done at two different
	 * times: a stocktake fills the shelves first and works down this list after,
	 * usually with the label printer in the other hand.
	 *
	 * One `<Form>` per row, each bound to `bindTag.for(id)`, so a bad tag fails
	 * against the row it belongs to rather than the page — the shape the
	 * check-in screen already uses.
	 */
	const assets = $derived(await getUntaggedAssets());
</script>

<PageHeader title="Needs tagging" subtitle="Inventory" backHref="/staff/inventory">
	{#if assets.length > 0}
		<Badge variant="warning" size="md">{assets.length} waiting</Badge>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if assets.length === 0}
		<EmptyState
			title="Everything is tagged"
			description="Units entered without a tag show up here until one is bound."
		/>
	{:else}
		<p class="mb-4 text-subtle">
			Oldest first — the order they were entered. Scan or type the tag on the sticker you are about
			to put on the unit.
		</p>

		<div class="space-y-3">
			{#each assets as asset (asset.id)}
				{@const form = bindTag.for(asset.id)}
				<InfoCard title={asset.item.name}>
					<div class="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
						<div>
							<a class="link text-sm" href={resolve(`/staff/inventory/assets/${asset.id}`)}>
								Open this unit
							</a>
							<div class="text-subtle text-sm">
								{#if asset.serialNumber}
									Serial {asset.serialNumber} ·
								{/if}
								{asset.location?.name ?? 'Unassigned'} · entered {formatDateShort(asset.createdAt)}
							</div>
						</div>

						<Form remote={form} successToast="Tag bound">
							<input {...form.fields.assetId.as('hidden', asset.id)} />
							<div class="flex items-end gap-2">
								<Field
									field={form.fields.assetTag}
									type="text"
									label="Asset tag"
									placeholder="CMC-000123"
								/>
								<SubmitButton label="Bind" />
							</div>
						</Form>
					</div>
				</InfoCard>
			{/each}
		</div>
	{/if}
</PageContent>
