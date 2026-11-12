<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import CategoryOptions from '#lib/components/inventory/CategoryOptions.svelte';
	import ItemResources from '#lib/components/inventory/ItemResources.svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getStaffItemDetail,
		getItemLoanFeed,
		getItemMovementFeed,
		editItem,
		deactivateItem,
		reactivateItem
	} from '#lib/remote/inventory.remote.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import {
		ActivateToggleAction,
		AddAssetAction,
		AdjustStockAction,
		BindTagAction,
		MarkOrderedAction,
		ReceiveStockAction,
		UseStockAction
	} from '#lib/components/actions/index.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { formatDateShort, formatCents, titleCase } from '#lib/utils/format.js';
	import { acquisitionKindLabels, equipmentConditionBadge, unitsOfMeasure } from '#lib/config.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const { fields } = editItem;

	let id = $derived(params.id);
	let itemId = $derived(id);
	// One query. The category list is not in it — see CategoryOptions for why it cannot be.
	const data = $derived(await getStaffItemDetail(id));
	const item = $derived(data.item);
	const assets = $derived(data.assets);
	const onOrder = $derived(data.onOrder);
	const onOrderTotal = $derived(onOrder.reduce((n, l) => n + l.outstanding, 0));
	// Null, not empty, when the viewer cannot triage reports.
	const problems = $derived(data.problems);
	const sources = $derived(data.sources);

	let isDeactivated = $derived(!!item.deletedAt);
	let isSerialized = $derived(item.kind === 'serialized');
</script>

<Form remote={editItem} guard successToast={msg.staff_inventory_id_success_toast()}>
	<input {...fields.id.as('hidden', id)} />
	<PageHeader
		subtitle={item.section === 'gear' ? msg.staff_gear_body() : msg.staff_supplies_body()}
		title={item.name}
	>
		{#if isDeactivated}
			<Badge variant="error" size="md">{msg.staff_deactivated_label()}</Badge>
		{/if}
		<SubmitButton shortcut="mod+s">
			{#snippet icon()}
				<IconDeviceFloppy size={20} />
			{/snippet}
		</SubmitButton>
	</PageHeader>
	<PageContent>
		<div class="mb-6 grid gap-6 lg:grid-cols-2">
			<InfoCard title={msg.staff_item_title()}>
				<div class="grid grid-cols-1 gap-x-2">
					<Field field={fields.name} type="text" value={item.name} />
					<Field field={fields.description} type="textarea" value={item.description ?? ''} />
					<Field
						field={fields.categoryId}
						type="select"
						value={item.categoryId}
						label={msg.staff_category_label()}
					>
						<CategoryOptions selected={item.categoryId} />
					</Field>
					<div class="grid grid-cols-2 gap-3">
						<Field
							field={fields.unitOfMeasure}
							type="select"
							label={msg.staff_unit_label()}
							value={item.unitOfMeasure}
							options={unitsOfMeasure.map((u) => ({ value: u, label: u }))}
						/>
						<Field
							field={fields.gtin}
							type="text"
							label={msg.staff_inventory_id_barcode_label()}
							value={item.gtin ?? ''}
						/>
					</div>
					<Field
						field={fields.isLoanable}
						type="checkbox"
						label={msg.staff_inventory_id_members_can_borrow_label()}
						value={item.isLoanable}
					/>
					{#if !isSerialized}
						<div class="grid grid-cols-2 gap-3">
							<Field
								field={fields.reorderPoint}
								type="number"
								label={msg.staff_reorder_at_label()}
								value={item.reorderPoint ?? undefined}
							/>
							<Field
								field={fields.reorderQuantity}
								type="number"
								label={msg.staff_inventory_id_reorder_quantity_label()}
								value={item.reorderQuantity ?? undefined}
							/>
						</div>
					{/if}
					<Field
						field={fields.resourceId}
						type="text"
						label={msg.staff_inventory_id_resource_id_label()}
						value={item.resourceId ?? ''}
					/>
					<Field field={fields.notes} type="textarea" value={item.notes ?? ''} />
				</div>
			</InfoCard>

			<InfoCard title={msg.staff_stock_title()} class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label={msg.staff_inventory_id_id_label()} mono>{item.id}</Fact>

					<Fact label={msg.staff_category_label()}>
						{item.category.name}
						<Badge variant="outline" size="xs" class="ml-1">{item.category.pricingTier}</Badge>
					</Fact>

					<Fact label={msg.staff_inventory_id_tracked_as_label()}>
						{titleCase(item.kind)}
						{#if item.isConsumable}
							<Badge variant="outline" size="xs" class="ml-1">{msg.staff_consumable_label()}</Badge>
						{/if}
					</Fact>

					<!-- On hand is the sum of the ledger below, never a stored number.
					     That is the whole point of the rebuild. -->
					<Fact label={msg.staff_hand_label()} class={item.isLowStock ? 'text-warning' : ''}>
						{item.onHand}
						{#if item.reorderPoint != null}
							<span class="text-subtle"
								>{msg.staff_inventory_id_reorder_at_text({ reorderPoint: item.reorderPoint })}</span
							>
						{/if}
					</Fact>

					<Fact
						label={msg.staff_available_label()}
						class={item.availableQuantity <= 0 ? 'text-error' : ''}
					>
						{item.availableQuantity}
					</Fact>

					{#if onOrderTotal > 0}
						<Fact label={msg.staff_order_label()}>{onOrderTotal}</Fact>
					{/if}
				</DefinitionList>

				<div class="mt-4 flex flex-wrap gap-2">
					<ReceiveStockAction itemId={id} />
					{#if isSerialized}
						<AddAssetAction itemId={id} />
					{:else}
						<UseStockAction itemId={id} />
						<AdjustStockAction itemId={id} onHand={item.onHand} />
						<MarkOrderedAction
							itemId={id}
							quantity={item.reorderQuantity ??
								Math.max(1, (item.reorderPoint ?? 0) - item.onHand + 1)}
						/>
					{/if}
				</div>

				<div class="mt-4 flex gap-2">
					<ActivateToggleAction
						entityId={id}
						{isDeactivated}
						deactivateAction={deactivateItem}
						reactivateAction={reactivateItem}
						entityLabel={msg.staff_item_label()}
					/>
				</div>
			</InfoCard>
		</div>
	</PageContent>
</Form>

<PageContent>
	{#if isSerialized}
		<InfoCard title={msg.staff_units_title()}>
			{#if assets.length === 0}
				<EmptyState description={msg.staff_inventory_id_no_units_recorded_yet_body()} />
			{:else}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">{msg.staff_status_label()}</span></th>
						<th>{msg.staff_tag_label()}</th>
						<th class="col-support">{msg.staff_serial_label()}</th>
						<th class="col-support">{msg.staff_condition_label()}</th>
						<th class="col-extra">{msg.staff_location_label()}</th>
					{/snippet}
					{#each assets as asset (asset.id)}
						<tr
							class="hover cursor-pointer"
							use:rowLink={resolve(`staff/inventory/assets/${asset.id}`)}
						>
							<td class="w-px"><StatusBadge status={asset.status} /></td>
							<td class="cell-primary">
								{#if asset.assetTag}
									<span class="font-mono">{asset.assetTag}</span>
								{:else}
									<!-- Gear gets entered before the roll of stickers arrives, so an
									     unbound unit is a normal state and says so. -->
									<span class="opacity-40">{msg.staff_inventory_id_untagged_text()}</span>
									<BindTagAction assetId={asset.id} />
								{/if}
							</td>
							<td class="col-support font-mono text-xs">{asset.serialNumber ?? '—'}</td>
							<td class="col-support">
								<Badge size="sm" class={equipmentConditionBadge[asset.condition] ?? 'badge-ghost'}>
									{titleCase(asset.condition)}
								</Badge>
							</td>
							<td class="col-extra">{asset.location?.name ?? '—'}</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	{/if}

	<!-- Current state first: these two appear only while something is open. -->
	{#if problems && problems.length > 0}
		<InfoCard
			title={msg.staff_inventory_id_open_problems_title()}
			state={problems.length}
			class="mt-6"
		>
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{msg.staff_status_label()}</span></th>
					<th>{msg.staff_note_label()}</th>
					<th class="col-support">{msg.staff_unit_label()}</th>
					<th class="col-extra whitespace-nowrap">{msg.staff_reported_label()}</th>
				{/snippet}
				{#each problems as problem (problem.id)}
					<tr
						class="hover cursor-pointer"
						use:rowLink={resolve(`staff/inventory/problems/${problem.id}`)}
					>
						<td class="w-px">
							<div class="flex w-max items-center gap-1">
								<StatusBadge status={problem.inWorkOrder ? 'in_progress' : 'pending'} />
								{#if problem.blocksUse}
									<Badge variant="error" size="xs">{msg.staff_inventory_id_out_use_label()}</Badge>
								{/if}
							</div>
						</td>
						<td class="cell-primary">{problem.note}</td>
						<td class="col-support font-mono text-xs">
							{problem.assetTag ?? problem.serialNumber ?? msg.staff_inventory_id_untagged_text()}
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShort(problem.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		</InfoCard>
	{/if}

	{#if onOrder.length > 0}
		<InfoCard title={msg.staff_inventory_id_open_orders_title()} state={onOrderTotal} class="mt-6">
			<Table>
				{#snippet head()}
					<th>{msg.staff_supplier_label()}</th>
					<th class="cell-num">{msg.staff_inventory_id_outstanding_label()}</th>
					<th class="col-support whitespace-nowrap">{msg.staff_expected_label()}</th>
					<th class="col-extra">{msg.staff_reference_label()}</th>
					<th class="w-px"><span class="sr-only">{msg.staff_receive_label()}</span></th>
				{/snippet}
				{#each onOrder as line (line.lineId)}
					<tr
						class="hover cursor-pointer"
						use:rowLink={resolve(`staff/inventory/orders/${line.orderId}`)}
					>
						<td class="cell-primary"
							>{line.supplierName ?? msg.staff_inventory_id_no_supplier_recorded_text()}</td
						>
						<td class="cell-num"
							>{msg.staff_inventory_id_text({
								outstanding: line.outstanding,
								quantityOrdered: line.quantityOrdered
							})}</td
						>
						<td class="col-support whitespace-nowrap">
							{line.expectedAt ? formatDateShort(line.expectedAt) : '—'}
						</td>
						<td class="col-extra">{line.reference ?? '—'}</td>
						<td class="w-px">
							<!-- Receiving is intake prefilled from the order, which closes the line. -->
							<Button
								variant="ghost"
								size="sm"
								href={withQuery(
									resolve('staff/inventory/intake'),
									new URLSearchParams({ order: line.orderId })
								)}>{msg.staff_receive_label()}</Button
							>
						</td>
					</tr>
				{/each}
			</Table>
		</InfoCard>
	{/if}

	<div class="mt-6">
		<ItemResources {itemId} />
	</div>

	<InfoCard title={msg.staff_inventory_id_past_acquisitions_title()} class="mt-6">
		{#if sources.length === 0}
			<EmptyState description={msg.staff_inventory_id_no_acquisition_recorded_body()} />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">{msg.staff_when_label()}</th>
					<th>{msg.staff_source_label()}</th>
					<th class="col-support">{msg.staff_kind_label()}</th>
					<th class="cell-num">{msg.staff_quantity_label()}</th>
					<th class="col-support cell-num">{msg.staff_unit_value_label()}</th>
				{/snippet}
				{#each sources as source (source.lineId)}
					<tr
						class="hover cursor-pointer"
						use:rowLink={resolve(`staff/inventory/acquisitions/${source.acquisitionId}`)}
					>
						<td class="whitespace-nowrap">{formatDateShort(source.occurredAt)}</td>
						<td class="cell-primary">{source.source ?? '—'}</td>
						<td class="col-support">{acquisitionKindLabels[source.kind]}</td>
						<td class="cell-num">{source.quantity}</td>
						<td class="col-support cell-num">
							{source.unitValueCents != null ? formatCents(source.unitValueCents) : '—'}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<ActivityFeedCard
		title={msg.staff_inventory_id_stock_movements_title()}
		class="mt-6"
		query={(limit) => getItemMovementFeed(limit ? { id, limit } : { id })}
		toRow={(m) => ({ ...feedItemRow(m), quantity: m.quantity })}
		empty={{ title: msg.staff_inventory_id_nothing_has_moved_yet_title() }}
	>
		{#snippet trailing(row)}
			<span class:text-error={row.quantity < 0}>
				{row.quantity > 0 ? '+' : ''}{row.quantity}
			</span>
		{/snippet}
	</ActivityFeedCard>

	<ActivityFeedCard
		title={msg.staff_inventory_id_loan_history_title()}
		class="mt-6"
		query={(limit) => getItemLoanFeed(limit ? { id, limit } : { id })}
		toRow={(l) => ({
			...feedItemRow(l),
			href: resolve('/staff/inventory/loans/[id]', { id: l.loanId }),
			loan: l
		})}
		empty={{ title: msg.staff_inventory_id_no_loan_history_title() }}
	>
		{#snippet trailing({ loan })}
			<div class="flex items-center justify-end gap-1">
				<StatusBadge status={loan.status} />
				{#if loan.isOverdue}
					<Badge variant="error" size="xs">{msg.staff_overdue_label()}</Badge>
				{/if}
			</div>
			<div class="text-muted text-xs">
				{[
					loan.dueDate && `due ${formatDateShort(loan.dueDate)}`,
					loan.chargeCents != null && formatCents(loan.chargeCents)
				]
					.filter(Boolean)
					.join(' · ')}
			</div>
		{/snippet}
	</ActivityFeedCard>
</PageContent>
