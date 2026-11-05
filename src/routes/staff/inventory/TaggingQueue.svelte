<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { getUntaggedAssets, bindTag } from '#lib/remote/inventory.remote.js';
	import { formatDateShort } from '#lib/utils/format.js';

	/**
	 * Units waiting for a sticker, worked through in a modal off the Inventory
	 * header. The queue is `asset_tag IS NULL`, never stored, so binding a tag is
	 * what removes a row. One `<Form>` per row, so a bad tag fails against its own
	 * unit. `?tagging` opens it; the old `/staff/inventory/tagging` redirects there.
	 */
	let open = $state(page.url.searchParams.has('tagging'));
	const assets = $derived(await getUntaggedAssets());
</script>

{#if assets.length > 0}
	<Button variant="ghost" size="sm" data-testid="tagging-queue" onclick={() => (open = true)}>
		{m.staff_inventory_tagging_queue_needs_tagging()}
		<Badge variant="warning" size="sm">{assets.length}</Badge>
	</Button>
{/if}

<Modal bind:open title={m.staff_inventory_tagging_queue_needs_tagging()} maxWidth="max-w-2xl">
	{#if assets.length === 0}
		<p class="py-4 text-subtle">{m.staff_inventory_tagging_queue_everything_tagged()}</p>
	{:else}
		<p class="mb-3 text-subtle text-sm">
			{m.staff_inventory_tagging_queue_oldest_first_scan_type_tag()}
		</p>
		<ul class="divide-y divide-base-300">
			{#each assets as asset (asset.id)}
				{@const form = bindTag.for(asset.id)}
				<li class="grid gap-2 py-3 md:grid-cols-[1fr_auto] md:items-end">
					<div class="min-w-0">
						<a
							class="font-medium hover:underline"
							href={resolve(`staff/inventory/assets/${asset.id}`)}
						>
							{asset.item.name}
						</a>
						<div class="text-subtle text-sm">
							{#if asset.serialNumber}{m.staff_inventory_tagging_queue_serial({
									serialNumber: asset.serialNumber
								})}{/if}
							{m.staff_inventory_tagging_queue_entered({
								value: asset.location?.name ?? m.staff_unassigned(),
								formatDateShort: formatDateShort(asset.createdAt)
							})}
						</div>
					</div>
					<Form remote={form} successToast={m.staff_inventory_tagging_queue_success_toast()}>
						<input {...form.fields.assetId.as('hidden', asset.id)} />
						<div class="flex items-end gap-2">
							<Field
								field={form.fields.assetTag}
								type="text"
								label={m.staff_asset_tag()}
								placeholder={m.staff_cmc_000123()}
							/>
							<SubmitButton label={m.staff_inventory_tagging_queue_bind()} />
						</div>
					</Form>
				</li>
			{/each}
		</ul>
	{/if}
</Modal>
