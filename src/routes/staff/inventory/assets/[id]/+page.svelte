<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { workOrderPathname } from '#lib/utils/work-order-href.js';
	import { page } from '$app/state';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getAssetHistory,
		getStaffAssetDetail,
		editAsset,
		changeAssetStatus,
		reopenAssetForm
	} from '#lib/remote/inventory.remote.js';
	import { withHash } from '#lib/utils/with-query.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import {
		BindTagAction,
		RecordForm8282Action,
		ReopenAction
	} from '#lib/components/actions/index.js';
	import LocationField from '#lib/components/inventory/LocationField.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatCents, toLocalDate } from '#lib/utils/format.js';
	import {
		equipmentConditions,
		contractorJobStatusBadge,
		contractorJobStatusLabels
	} from '#lib/config.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const { fields } = editAsset;
	const statusFields = changeAssetStatus.fields;

	let id = $derived(params.id);
	const data = $derived(await getStaffAssetDetail(id));
	const asset = $derived(data.asset);
	type HistoryItem = NonNullable<Awaited<ReturnType<typeof getAssetHistory>>>['items'][number];
	function historyRow(item: HistoryItem) {
		const row = { ...feedItemRow(item), item };
		if (item.kind !== 'service') return row;
		return {
			...row,
			href: withHash(
				resolve(workOrderPathname({ id: item.job.workOrderId, projectId: item.job.projectId })),
				`engagement-${item.job.id}`
			),
			context: {
				label: item.contractor.name,
				href: resolve('/staff/contractors/[id]', { id: item.contractor.id })
			}
		};
	}
	const form8282 = $derived(data.form8282);

	/**
	 * `retired` and `lost` are terminal, so the status controls are not offered;
	 * leaving them is the admin-only Reopen.
	 */
	let isTerminal = $derived(asset.status === 'retired' || asset.status === 'lost');
</script>

<PageHeader
	width="3xl"
	subtitle={asset.item.name}
	title={asset.assetTag ?? m.staff_inventory_assets_id_untagged_unit_title()}
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
					<ParaglideMessage
						message={m.staff_inventory_assets_id_unit_was_donated_text}
						inputs={{
							staff_inventory_assets_id_form_8282_may_due:
								m.staff_inventory_assets_id_form_8282_may_due_text()
						}}
						>{#snippet strong({ children })}<strong>{@render children?.()}</strong
							>{/snippet}</ParaglideMessage
					>{#if data.donor}
						{m.staff_inventory_assets_id_by_text({
							donor: data.donor
						})}{/if}{m.staff_inventory_assets_id_cmc_signed_form_8283_was_text()}
				</p>
				<p class="mt-1 text-sm">
					{#if form8282.state === 'overdue'}
						{m.staff_inventory_assets_id_125_days_ran_out_text({
							value: (form8282.dueBy && toLocalDate(form8282.dueBy)) ?? ''
						})}
					{:else}
						{m.staff_inventory_assets_id_due_by_days_left_text({
							value: (form8282.dueBy && toLocalDate(form8282.dueBy)) ?? '',
							daysRemaining: form8282.daysRemaining ?? ''
						})}
					{/if}
				</p>
				<div class="mt-3">
					<RecordForm8282Action assetId={id} dueBy={form8282.dueBy} />
				</div>
			</div>
		</Alert>
	{/if}

	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<Form remote={editAsset} guard successToast={m.staff_inventory_assets_id_unit_updated_toast()}>
			<input {...fields.id.as('hidden', id)} />
			<InfoCard title={m.staff_inventory_assets_id_unit_title()}>
				<Field
					field={fields.serialNumber}
					type="text"
					label={m.staff_inventory_assets_id_serial_number_label()}
					value={asset.serialNumber ?? ''}
				/>
				<Field
					field={fields.condition}
					type="select"
					label={m.staff_condition_label()}
					value={asset.condition}
					options={equipmentConditions.map((c) => ({ value: c, label: c }))}
				/>
				<!-- Load-bearing, not decorative: without this field the form sent no
				     `locationId` on every save, and the handler read that absence as
				     "clear it". Gear moved to Unassigned whenever anyone edited a
				     serial number. -->
				<LocationField field={fields.locationId} value={asset.locationId} />
				<Field
					field={fields.notes}
					type="textarea"
					label={m.staff_notes_label()}
					value={asset.notes ?? ''}
				/>
				<div class="mt-3">
					<SubmitButton>
						{#snippet icon()}
							<IconDeviceFloppy size={20} />
						{/snippet}
					</SubmitButton>
				</div>
			</InfoCard>
		</Form>

		<InfoCard title={m.staff_record_title()} class="bg-base-200 shadow-none">
			<DefinitionList>
				<Fact label={m.staff_item_label()}>{asset.item.name}</Fact>
				<Fact label={m.staff_category_label()}>
					{asset.category.name}
					<Badge variant="outline" size="xs" class="ml-1">{asset.category.pricingTier}</Badge>
				</Fact>
				<Fact label={m.staff_tag_label()} mono>{asset.assetTag ?? '—'}</Fact>
				<Fact label={m.staff_location_label()}
					>{asset.location?.name ?? m.staff_unassigned_text()}</Fact
				>
				<Fact label={m.staff_inventory_assets_id_added_label()}
					>{formatDateShort(asset.createdAt)}</Fact
				>
				{#if asset.form8282ResolvedAt}
					<Fact label={m.staff_inventory_assets_id_form_8282_label()}>
						{asset.form8282Note}
						<span class="text-subtle">
							{m.staff_inventory_assets_id_recorded_text({
								toLocalDate: toLocalDate(asset.form8282ResolvedAt)
							})}
						</span>
					</Fact>
				{/if}
				{#if asset.retiredAt}
					<Fact label={m.staff_retired_label()}>
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
					{m.staff_inventory_assets_id_text({ origin: page.url.origin, assetTag: asset.assetTag })}
				</p>
			{/if}

			<div class="mt-4 flex flex-wrap gap-2">
				<BindTagAction assetId={id} currentTag={asset.assetTag} />
				{#if isTerminal}
					<ReopenAction action={reopenAssetForm} {id} capability="inventory.reopen">
						{m.staff_inventory_assets_id_back_service_with_stock_adjustment_text({
							status: asset.status
						})}
					</ReopenAction>
				{/if}
			</div>

			{#if !isTerminal}
				<Form
					remote={changeAssetStatus}
					guard
					successToast={m.staff_inventory_assets_id_status_updated_toast()}
					class="mt-4"
				>
					<input {...statusFields.id.as('hidden', id)} />
					<div class="grid grid-cols-2 gap-3">
						<Field
							field={statusFields.status}
							type="select"
							label={m.staff_inventory_assets_id_move_label()}
							value={asset.status}
							options={[
								{ value: 'in_service', label: m.staff_inventory_assets_id_service_label() },
								{ value: 'maintenance', label: m.staff_inventory_assets_id_maintenance_label() },
								{ value: 'retired', label: m.staff_retired_label() },
								{ value: 'lost', label: m.staff_inventory_assets_id_lost_label() }
							]}
						/>
						<Field field={statusFields.notes} type="text" label={m.staff_why_label()} />
					</div>
					<div class="mt-2">
						<SubmitButton
							label={m.staff_inventory_assets_id_update_status_label()}
							variant="ghost"
						/>
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
		title={m.staff_history_title()}
		query={(limit) => getAssetHistory(limit ? { id, limit } : { id })}
		toRow={historyRow}
		empty={{ title: m.staff_inventory_assets_id_nothing_recorded_against_unit_yet_title() }}
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
