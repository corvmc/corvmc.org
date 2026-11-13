<!--
	What the bill asks CMC to supply, against the catalog (#2724).

	A staff match to a catalog item wins; without one, a category whose name
	serves the element's kind is offered as a suggestion. Demand is per act, since
	acts on one night share the backline between sets.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { setRiderStock } from '#lib/remote/productions.remote.js';
	import type { RiderStockCheck } from '#lib/types/rider-stock.js';
	import { stockState } from './section-state';

	let {
		eventId,
		check,
		onchange
	}: { eventId: string; check: RiderStockCheck; onchange: () => void } = $props();

	const options = $derived([
		{ value: '', label: m.ui_none_label() },
		...check.catalog.map((c) => ({ value: c.id, label: `${c.categoryName} · ${c.name}` }))
	]);
</script>

<InfoCard
	title={m.staff_events_id_production_rider_stock_panel_requested_gear_title()}
	state={stockState(check)}
>
	{#if check.lines.length === 0}
		<EmptyState title={m.staff_events_id_production_rider_stock_panel_none_requested_title()} />
	{:else}
		<ul class="divide-y divide-base-300">
			{#each check.lines as line (line.elementId)}
				<li class="flex flex-wrap items-center gap-2 py-2" data-testid="stock-line">
					<span class="font-medium">{line.actName}</span>
					<span class="text-sm">{line.label}</span>
					{#if !line.match}
						<Badge variant="warning"
							>{m.staff_events_id_production_rider_stock_panel_not_stocked_label()}</Badge
						>
					{:else}
						<span class="text-subtle text-sm"
							>{line.match.via === 'link' ? line.match.itemName : line.match.categoryName}</span
						>
						{#if line.match.via === 'category'}
							<Badge variant="ghost"
								>{m.staff_events_id_production_rider_stock_panel_suggested_label()}</Badge
							>
						{/if}
						{#if line.short}
							<Badge variant="error"
								>{m.staff_events_id_production_rider_stock_panel_free_label({
									available: line.available ?? 0,
									needed: line.needed
								})}</Badge
							>
						{/if}
					{/if}
					<div class="ml-auto">
						<Action
							action={setRiderStock}
							label={m.staff_events_id_production_rider_stock_panel_match_item_label()}
							variant="ghost"
							size="sm"
							modalTitle={m.staff_events_id_production_rider_stock_panel_match_title({
								label: line.label
							})}
							submitLabel={m.staff_save_label()}
							successToast={m.staff_events_id_production_rider_stock_panel_match_saved_toast()}
							onsuccess={onchange}
						>
							{#snippet form()}
								<input {...setRiderStock.fields.eventId.as('hidden', eventId)} />
								<input {...setRiderStock.fields.elementId.as('hidden', line.elementId)} />
								<FormField
									field={setRiderStock.fields.itemId}
									label={m.staff_events_id_production_rider_stock_panel_catalog_item_label()}
									type="select"
									value={line.match?.via === 'link' ? line.match.itemId : ''}
									{options}
								/>
							{/snippet}
						</Action>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
