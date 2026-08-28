<script lang="ts">
	import { page } from '$app/state';
	import CategoryOptions from '$lib/components/inventory/CategoryOptions.svelte';
	import ItemResources from '$lib/components/inventory/ItemResources.svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getStaffItemDetail,
		editItem,
		deactivateItem,
		reactivateItem
	} from '$lib/remote/inventory.remote';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import {
		ActivateToggleAction,
		AddAssetAction,
		AdjustStockAction,
		ReceiveStockAction,
		UseStockAction
	} from '$lib/components/actions';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatCents, titleCase } from '$lib/utils/format';
	import { equipmentConditionBadge, stockReasonLabels, unitsOfMeasure } from '$lib/config';

	const { fields } = editItem;

	let id = $derived(page.params.id!);
	let itemId = $derived(id);
	// One query. The category list is not in it — see CategoryOptions for why it cannot be.
	const data = $derived(await getStaffItemDetail(id));
	const item = $derived(data.item);
	const assets = $derived(data.assets);
	const movements = $derived(data.movements);
	const loanHistory = $derived(data.loanHistory);

	let isDeactivated = $derived(!!item.deletedAt);
	let isSerialized = $derived(item.kind === 'serialized');
</script>

<Form remote={editItem} guard successToast="Item updated">
	<input {...fields.id.as('hidden', id)} />
	<PageHeader subtitle="Inventory" title={item.name} backHref="/staff/inventory">
		{#if isDeactivated}
			<Badge variant="error" size="md">Deactivated</Badge>
		{/if}
		<SubmitButton shortcut="mod+s">
			{#snippet icon()}
				<IconDeviceFloppy size={20} />
			{/snippet}
		</SubmitButton>
	</PageHeader>
	<PageContent width="3xl">
		<div class="mb-6 grid gap-6 lg:grid-cols-2">
			<InfoCard title="Item">
				<div class="grid grid-cols-1 gap-x-2">
					<Field field={fields.name} type="text" value={item.name} />
					<Field field={fields.description} type="textarea" value={item.description ?? ''} />
					<Field field={fields.categoryId} type="select" value={item.categoryId} label="Category">
						<CategoryOptions selected={item.categoryId} />
					</Field>
					<div class="grid grid-cols-2 gap-3">
						<Field
							field={fields.unitOfMeasure}
							type="select"
							label="Unit"
							value={item.unitOfMeasure}
							options={unitsOfMeasure.map((u) => ({ value: u, label: u }))}
						/>
						<Field field={fields.gtin} type="text" label="Barcode" value={item.gtin ?? ''} />
					</div>
					<Field
						field={fields.isLoanable}
						type="checkbox"
						label="Members can borrow this"
						value={item.isLoanable}
					/>
					{#if !isSerialized}
						<div class="grid grid-cols-2 gap-3">
							<Field
								field={fields.reorderPoint}
								type="number"
								label="Reorder at"
								value={item.reorderPoint ?? undefined}
							/>
							<Field
								field={fields.reorderQuantity}
								type="number"
								label="Reorder quantity"
								value={item.reorderQuantity ?? undefined}
							/>
						</div>
					{/if}
					<Field
						field={fields.resourceId}
						type="text"
						label="Resource ID"
						value={item.resourceId ?? ''}
					/>
					<Field field={fields.notes} type="textarea" value={item.notes ?? ''} />
				</div>
			</InfoCard>

			<InfoCard title="Stock" class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label="ID" mono>{item.id}</Fact>

					<Fact label="Category">
						{item.category.name}
						<Badge variant="outline" size="xs" class="ml-1">{item.category.pricingTier}</Badge>
					</Fact>

					<Fact label="Tracked as">
						{titleCase(item.kind)}
						{#if item.isConsumable}
							<Badge variant="outline" size="xs" class="ml-1">Consumable</Badge>
						{/if}
					</Fact>

					<!-- On hand is the sum of the ledger below, never a stored number.
					     That is the whole point of the rebuild. -->
					<Fact label="On hand" class={item.isLowStock ? 'text-warning' : ''}>
						{item.onHand}
						{#if item.reorderPoint != null}
							<span class="text-subtle">(reorder at {item.reorderPoint})</span>
						{/if}
					</Fact>

					<Fact label="Available" class={item.availableQuantity <= 0 ? 'text-error' : ''}>
						{item.availableQuantity}
					</Fact>
				</DefinitionList>

				<div class="mt-4 flex flex-wrap gap-2">
					<ReceiveStockAction itemId={id} />
					{#if isSerialized}
						<AddAssetAction itemId={id} />
					{:else}
						<UseStockAction itemId={id} />
						<AdjustStockAction itemId={id} onHand={item.onHand} />
					{/if}
				</div>

				<div class="mt-4 flex gap-2">
					<ActivateToggleAction
						entityId={id}
						{isDeactivated}
						deactivateAction={deactivateItem}
						reactivateAction={reactivateItem}
						entityLabel="Item"
					/>
				</div>
			</InfoCard>
		</div>
	</PageContent>
</Form>

<PageContent width="3xl">
	{#if isSerialized}
		<InfoCard title="Units">
			{#if assets.length === 0}
				<EmptyState description="No units recorded yet" />
			{:else}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Tag</th>
						<th class="col-support">Serial</th>
						<th class="col-support">Condition</th>
						<th class="col-extra">Location</th>
					{/snippet}
					{#each assets as asset (asset.id)}
						<tr
							class="hover cursor-pointer"
							use:rowLink={resolve(`/staff/inventory/assets/${asset.id}`)}
						>
							<td class="w-px"><StatusBadge status={asset.status} /></td>
							<td class="cell-primary">
								{#if asset.assetTag}
									<span class="font-mono">{asset.assetTag}</span>
								{:else}
									<!-- Gear gets entered before the roll of stickers arrives, so an
									     unbound unit is a normal state and says so. -->
									<span class="opacity-40">Untagged</span>
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

	<div class="mt-6">
		<ItemResources {itemId} />
	</div>

	<InfoCard title="Stock movements" class="mt-6">
		{#if movements.length === 0}
			<EmptyState description="Nothing has moved yet" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">When</th>
					<th>What happened</th>
					<th class="cell-num">Change</th>
					<th class="col-extra">Note</th>
				{/snippet}
				{#each movements as movement (movement.id)}
					<tr>
						<td class="whitespace-nowrap">{formatDateShort(movement.occurredAt)}</td>
						<td class="cell-primary">{stockReasonLabels[movement.reason]}</td>
						<td class="cell-num" class:text-error={movement.quantity < 0}>
							{movement.quantity > 0 ? '+' : ''}{movement.quantity}
						</td>
						<td class="col-extra">{movement.notes ?? '—'}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title="Loan History" class="mt-6">
		{#if loanHistory.length === 0}
			<EmptyState description="No loan history" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Member</th>
					<th class="col-support whitespace-nowrap">Due</th>
					<th class="col-extra whitespace-nowrap">Requested</th>
					<th class="col-support cell-num">Charge</th>
				{/snippet}
				{#each loanHistory as loan (loan.id)}
					<tr
						class="hover cursor-pointer"
						use:rowLink={resolve(`/staff/inventory/loans/${loan.id}`)}
					>
						<td class="w-px">
							<div class="flex items-center gap-1">
								<StatusBadge status={loan.status} />
								{#if loan.isOverdue}
									<Badge variant="error" size="xs">Overdue</Badge>
								{/if}
							</div>
						</td>
						<td class="cell-primary">
							<EntityIdentity ref={loan.member} />
						</td>
						<td class="col-support whitespace-nowrap">
							{loan.dueDate ? formatDateShort(loan.dueDate) : '—'}
						</td>
						<td class="col-extra whitespace-nowrap">
							{formatDateShort(loan.requestedPickupDate)}
						</td>
						<td class="col-support cell-num">
							{loan.totalChargeCents != null ? formatCents(loan.totalChargeCents) : '—'}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>
