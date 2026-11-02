<script lang="ts">
	import { workOrderHref } from '$lib/utils/work-order-href';
	import { page } from '$app/state';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getAssetHistory,
		getStaffAssetDetail,
		editAsset,
		changeAssetStatus
	} from '$lib/remote/inventory.remote';
	import type { ResolvedPathname } from '$app/types';
	import { ActivityFeedCard, feedItemRow } from '$lib/components/ui/ActivityFeed';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { BindTagAction, RecordForm8282Action } from '$lib/components/actions';
	import LocationField from '$lib/components/inventory/LocationField.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatCents, toLocalDate } from '$lib/utils/format';
	import {
		equipmentConditions,
		contractorJobStatusBadge,
		contractorJobStatusLabels
	} from '$lib/config';

	const { fields } = editAsset;
	const statusFields = changeAssetStatus.fields;

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffAssetDetail(id));
	const asset = $derived(data.asset);
	type HistoryItem = NonNullable<Awaited<ReturnType<typeof getAssetHistory>>>['items'][number];
	function historyRow(item: HistoryItem) {
		const row = { ...feedItemRow(item), item };
		if (item.kind !== 'service') return row;
		return {
			...row,
			href: `${resolve(workOrderHref({ id: item.job.workOrderId, projectId: item.job.projectId }))}#engagement-${item.job.id}` as ResolvedPathname,
			context: {
				label: item.contractor.name,
				href: resolve('/staff/contractors/[id]', { id: item.contractor.id })
			}
		};
	}
	const form8282 = $derived(data.form8282);

	/**
	 * `retired` and `lost` are terminal, so the controls that would move a unit
	 * out of them are not offered — the service refuses anyway, and a button that
	 * always errors is worse than no button.
	 */
	let isTerminal = $derived(asset.status === 'retired' || asset.status === 'lost');
</script>

<PageHeader
	width="3xl"
	subtitle={asset.item.name}
	title={asset.assetTag ?? 'Untagged unit'}
	parent={{ label: asset.item.name, href: resolve('/staff/inventory/[id]', { id: asset.itemId }) }}
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
						The 125 days ran out on {form8282.dueBy && toLocalDate(form8282.dueBy)}.
					{:else}
						Due by {form8282.dueBy && toLocalDate(form8282.dueBy)} — {form8282.daysRemaining} days left.
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
							— recorded {toLocalDate(asset.form8282ResolvedAt)}
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

	<!--
		The ledger and the paid work on this unit, as one feed: a movement says it
		left and came back, a service row who had it and what they charged.
	-->
	<ActivityFeedCard
		title="History"
		query={(limit) => getAssetHistory(limit ? { id, limit } : { id })}
		toRow={historyRow}
		empty={{ title: 'Nothing recorded against this unit yet' }}
	>
		{#snippet trailing({ item })}
			{#if item.kind === 'service'}
				<Badge variant={contractorJobStatusBadge[item.job.status]} size="sm">
					{contractorJobStatusLabels[item.job.status]}
				</Badge>
				{#if item.costCents != null}
					<div class="text-muted text-xs">{formatCents(item.costCents)}</div>
				{/if}
			{/if}
		{/snippet}
	</ActivityFeedCard>
</PageContent>
