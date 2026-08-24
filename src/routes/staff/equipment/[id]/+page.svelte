<script lang="ts">
	import { page } from '$app/state';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getEquipment,
		getEquipmentCategories as getCategories,
		getEquipmentLoanHistory,
		editEquipment,
		deactivateEquipment,
		reactivateEquipment
	} from '$lib/remote/equipment.remote';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/shared/Form';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { ActivateToggleAction } from '$lib/components/shared/actions';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Table from '$lib/components/shared/Table.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatCents } from '$lib/utils/format';
	import { equipmentConditions, equipmentStatuses } from '$lib/config';

	const { fields } = editEquipment;

	let id = $derived(page.params.id!);
	let item = $derived(await getEquipment(id));
	let categories = $derived(await getCategories());
	let loanHistory = $derived(await getEquipmentLoanHistory(id));

	let isDeactivated = $derived(!!item.deletedAt);
</script>

<Form remote={editEquipment} guard successToast="Equipment updated">
	<input {...fields.id.as('hidden', id)} />
	<PageHeader subtitle="Equipment" title={item.name} backHref="/staff/equipment">
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
		<div class="grid gap-6 lg:grid-cols-2 mb-6">
			<InfoCard title="Equipment Info">
				<div class="grid grid-cols-1 gap-x-2">
					<Field field={fields.name} type="text" value={item.name} />
					<Field field={fields.description} type="textarea" value={item.description ?? ''} />
					<Field field={fields.categoryId} type="select" value={item.categoryId} label="Category">
						{#each categories as cat (cat.id)}
							<option value={cat.id}>{cat.name}</option>
						{/each}
					</Field>
					<div class="grid grid-cols-2 gap-3">
						<Field field={fields.condition} type="select" value={item.condition}>
							{#each equipmentConditions as c (c)}
								<option value={c}>{c}</option>
							{/each}
						</Field>
						<Field field={fields.status} type="select" value={item.status}>
							{#each equipmentStatuses as s (s)}
								<option value={s}>{s}</option>
							{/each}
						</Field>
					</div>
					<Field field={fields.notes} type="textarea" value={item.notes ?? ''} />
				</div>
			</InfoCard>

			<InfoCard title="Inventory" class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label="ID" mono>{item.id}</Fact>

					<Fact label="Category">
						{item.category.name}
						<Badge variant="outline" size="xs" class="ml-1">{item.category.pricingTier}</Badge>
					</Fact>

					<Fact label="Available" class={item.availableQuantity <= 0 ? 'text-error' : ''}>
						{item.availableQuantity} of {item.totalQuantity}
						{#if item.outOfOrderQuantity > 0}
							<span class="text-warning text-xs">({item.outOfOrderQuantity} out of order)</span>
						{/if}
						{#if item.loanedQuantity > 0}
							<span class="text-info text-xs">({item.loanedQuantity} on loan)</span>
						{/if}
					</Fact>
				</DefinitionList>

				<div class="grid grid-cols-2 gap-3 mt-4">
					<Field
						field={fields.totalQuantity}
						type="number"
						value={item.totalQuantity}
						label="Total Qty"
					/>
					<Field
						field={fields.outOfOrderQuantity}
						type="number"
						value={item.outOfOrderQuantity}
						label="Out of Order"
					/>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<Field
						field={fields.serialNumber}
						type="text"
						value={item.serialNumber ?? ''}
						label="Serial Number"
					/>
					<Field
						field={fields.resourceId}
						type="text"
						value={item.resourceId ?? ''}
						label="Resource ID"
					/>
				</div>

				<div class="mt-4 flex gap-2">
					<ActivateToggleAction
						entityId={id}
						{isDeactivated}
						deactivateAction={deactivateEquipment}
						reactivateAction={reactivateEquipment}
						entityLabel="Equipment"
					/>
				</div>
			</InfoCard>
		</div>
	</PageContent>
</Form>

<PageContent width="3xl">
	<InfoCard title="Loan History">
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
						use:rowLink={resolve(`/staff/equipment/loans/${loan.id}`)}
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
