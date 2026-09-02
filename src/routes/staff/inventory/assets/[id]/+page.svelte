<script lang="ts">
	import { page } from '$app/state';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { getStaffAssetDetail, editAsset, changeAssetStatus } from '$lib/remote/inventory.remote';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { BindTagAction, RecordForm8282Action } from '$lib/components/actions';
	import LocationField from '$lib/components/inventory/LocationField.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatCents } from '$lib/utils/format';
	import {
		equipmentConditions,
		stockReasonLabels,
		contractorJobStatusBadge,
		contractorJobStatusLabels,
		type ContractorJobStatus
	} from '$lib/config';

	const { fields } = editAsset;
	const statusFields = changeAssetStatus.fields;

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffAssetDetail(id));
	const asset = $derived(data.asset);
	const movements = $derived(data.movements);
	const serviceHistory = $derived(data.serviceHistory);
	const form8282 = $derived(data.form8282);

	/**
	 * `retired` and `lost` are terminal, so the controls that would move a unit
	 * out of them are not offered — the service refuses anyway, and a button that
	 * always errors is worse than no button.
	 */
	let isTerminal = $derived(asset.status === 'retired' || asset.status === 'lost');
</script>

<PageHeader
	subtitle={asset.item.name}
	title={asset.assetTag ?? 'Untagged unit'}
	backHref={resolve(`/staff/inventory/${asset.itemId}`)}
>
	<StatusBadge status={asset.status} />
</PageHeader>

<PageContent width="3xl">
	<!-- Above the record itself, because it is the only thing on this page with a
	     deadline attached. -->
	{#if form8282.state === 'due' || form8282.state === 'overdue'}
		<Alert type={form8282.state === 'overdue' ? 'error' : 'warning'} class="mb-4">
			<div>
				<p>
					<strong>Form 8282 may be due.</strong>
					This unit was donated{#if data.donor}
						by {data.donor}{/if}, CMC signed a Form 8283 for it, and it was disposed of within three
					years — which can oblige a filing within 125 days, with a copy to the donor.
				</p>
				<p class="mt-1 text-sm">
					{#if form8282.state === 'overdue'}
						The 125 days ran out on {form8282.dueBy?.toISOString().slice(0, 10)}.
					{:else}
						Due by {form8282.dueBy?.toISOString().slice(0, 10)} — {form8282.daysRemaining} days left.
					{/if}
				</p>
				<div class="mt-3">
					<RecordForm8282Action assetId={id} dueBy={form8282.dueBy} />
				</div>
			</div>
		</Alert>
	{/if}

	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<Form remote={editAsset} guard successToast="Unit updated">
			<input {...fields.id.as('hidden', id)} />
			<InfoCard title="This unit">
				<Field
					field={fields.serialNumber}
					type="text"
					label="Serial number"
					value={asset.serialNumber ?? ''}
				/>
				<Field
					field={fields.condition}
					type="select"
					label="Condition"
					value={asset.condition}
					options={equipmentConditions.map((c) => ({ value: c, label: c }))}
				/>
				<!-- Load-bearing, not decorative: without this field the form sent no
				     `locationId` on every save, and the handler read that absence as
				     "clear it". Gear moved to Unassigned whenever anyone edited a
				     serial number. -->
				<LocationField field={fields.locationId} value={asset.locationId} />
				<Field field={fields.notes} type="textarea" label="Notes" value={asset.notes ?? ''} />
				<div class="mt-3">
					<SubmitButton>
						{#snippet icon()}
							<IconDeviceFloppy size={20} />
						{/snippet}
					</SubmitButton>
				</div>
			</InfoCard>
		</Form>

		<InfoCard title="Record" class="bg-base-200 shadow-none">
			<DefinitionList>
				<Fact label="Item">{asset.item.name}</Fact>
				<Fact label="Category">
					{asset.category.name}
					<Badge variant="outline" size="xs" class="ml-1">{asset.category.pricingTier}</Badge>
				</Fact>
				<Fact label="Tag" mono>{asset.assetTag ?? '—'}</Fact>
				<Fact label="Location">{asset.location?.name ?? 'Unassigned'}</Fact>
				<Fact label="Added">{formatDateShort(asset.createdAt)}</Fact>
				{#if asset.form8282ResolvedAt}
					<Fact label="Form 8282">
						{asset.form8282Note}
						<span class="text-subtle">
							— recorded {asset.form8282ResolvedAt.toISOString().slice(0, 10)}
						</span>
					</Fact>
				{/if}
				{#if asset.retiredAt}
					<Fact label="Retired">
						{formatDateShort(asset.retiredAt)}
						{#if asset.retiredReason}
							<span class="text-subtle">— {asset.retiredReason}</span>
						{/if}
					</Fact>
				{/if}
			</DefinitionList>

			{#if asset.assetTag}
				<!-- The URL printed on the sticker. It resolves through entityHref, so
				     it keeps working when the pages behind it move. -->
				<p class="mt-3 font-mono text-subtle">
					{page.url.origin}/a/{asset.assetTag}
				</p>
			{/if}

			<div class="mt-4 flex flex-wrap gap-2">
				<BindTagAction assetId={id} currentTag={asset.assetTag} />
			</div>

			{#if !isTerminal}
				<Form remote={changeAssetStatus} guard successToast="Status updated" class="mt-4">
					<input {...statusFields.id.as('hidden', id)} />
					<div class="grid grid-cols-2 gap-3">
						<Field
							field={statusFields.status}
							type="select"
							label="Move to"
							value={asset.status}
							options={[
								{ value: 'in_service', label: 'In service' },
								{ value: 'maintenance', label: 'Maintenance' },
								{ value: 'retired', label: 'Retired' },
								{ value: 'lost', label: 'Lost' }
							]}
						/>
						<Field field={statusFields.notes} type="text" label="Why" />
					</div>
					<div class="mt-2">
						<SubmitButton label="Update status" variant="ghost" />
					</div>
				</Form>
			{/if}
		</InfoCard>
	</div>

	<InfoCard title="History">
		{#if movements.length === 0}
			<EmptyState description="Nothing recorded against this unit yet" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">When</th>
					<th>What happened</th>
					<th class="col-extra">Note</th>
				{/snippet}
				{#each movements as movement (movement.id)}
					<tr>
						<td class="whitespace-nowrap">{formatDateShort(movement.occurredAt)}</td>
						<td class="cell-primary">{stockReasonLabels[movement.reason]}</td>
						<td class="col-extra">{movement.notes ?? '—'}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<!--
		Paid work, kept apart from the ledger above. A movement says the unit left
		and came back; it cannot say who had it, what they charged, or that it is a
		fortnight late — and those are the questions somebody actually asks of a
		unit that has been in the shop three times.
	-->
	<InfoCard title="Service">
		{#if serviceHistory.length === 0}
			<EmptyState description="No contractor has worked on this unit" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">When</th>
					<th>Work</th>
					<th>Contractor</th>
					<th class="cell-num">Cost</th>
				{/snippet}
				{#each serviceHistory as row (row.job.id)}
					<tr>
						<td class="whitespace-nowrap">
							{#if row.job.completedAt}
								{formatDateShort(row.job.completedAt)}
							{:else if row.job.scheduledFor}
								{formatDateShort(row.job.scheduledFor)}
							{:else}
								—
							{/if}
						</td>
						<td class="cell-primary">
							<a class="link" href={resolve(`/staff/contractors/jobs/${row.job.id}`)}>
								{row.job.summary}
							</a>
							<Badge
								variant={contractorJobStatusBadge[row.job.status as ContractorJobStatus]}
								size="sm"
							>
								{contractorJobStatusLabels[row.job.status as ContractorJobStatus]}
							</Badge>
						</td>
						<td>
							<a class="link" href={resolve(`/staff/contractors/${row.contractor.id}`)}>
								{row.contractor.name}
							</a>
						</td>
						<td class="cell-num">
							{row.job.costCents != null ? formatCents(row.job.costCents) : '—'}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>
