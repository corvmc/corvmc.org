<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { RecordForm8282Action } from '#lib/components/actions/index.js';
	import { resolve } from '$app/paths';
	import { getForm8282Obligations } from '#lib/remote/inventory.remote.js';
	import StaffViews from '../../StaffViews.svelte';
	import { gearViews } from '../views';
	import { formatCents, formatDateShort } from '#lib/utils/format.js';

	/**
	 * Donated units disposed of within three years, where nobody has recorded what
	 * happened about Form 8282 yet.
	 *
	 * The asset page raises this the moment a unit is retired, but the deadline is
	 * 125 days out and the person who retires a thing is rarely the person who
	 * files paperwork. This is the list that keeps one from being quietly missed
	 * between those two facts.
	 */
	const data = $derived(await getForm8282Obligations());
</script>

<PageHeader title={m.staff_gear_title()} documentTitle={m.staff_gear_compliance_label()}>
	<StaffViews views={gearViews} active="compliance" />
</PageHeader>

<PageContent>
	{#if data.rows.length === 0}
		<EmptyState
			title={m.staff_inventory_compliance_nothing_outstanding_title()}
			description={data.noFormOnRecord > 0
				? m.staff_inventory_compliance_donated_disposed_inside_three_yea_body({
						noFormOnRecord: data.noFormOnRecord,
						value: data.noFormOnRecord === 1 ? 'unit was' : 'units were'
					})
				: m.staff_inventory_compliance_no_donated_gear_has_been_body()}
		/>
	{:else}
		{#if data.overdueCount > 0}
			<Alert type="error" class="mb-4">
				{data.overdueCount === 1
					? m.staff_inventory_compliance_one_filing_window_has_already_body()
					: m.staff_inventory_compliance_filing_windows_have_already_close_body({
							overdueCount: data.overdueCount
						})}
			</Alert>
		{/if}

		<!-- Stated once, at the top: the system is flagging, not determining. -->
		<p class="mb-4 text-subtle">
			{m.staff_inventory_compliance_disposing_donated_property_within_text()}
		</p>

		<Table>
			{#snippet head()}
				<th>{m.staff_unit_label()}</th>
				<th class="col-support">{m.staff_inventory_compliance_donor_label()}</th>
				<th class="col-extra whitespace-nowrap">{m.staff_received_label()}</th>
				<th class="whitespace-nowrap">{m.staff_inventory_compliance_disposed_label()}</th>
				<th class="whitespace-nowrap">{m.staff_inventory_compliance_due_by_label()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_record_label()}</span></th>
			{/snippet}
			{#each data.rows as row (row.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="font-medium" href={resolve(`staff/inventory/assets/${row.id}`)}>
							{row.itemName}
						</a>
						{#if row.assetTag}
							<div class="font-mono text-subtle">{row.assetTag}</div>
						{/if}
						{#if row.fairValueCents}
							<Badge variant="outline" size="xs">{formatCents(row.fairValueCents)}</Badge>
						{/if}
					</td>
					<td class="col-support">{row.donor ?? '—'}</td>
					<td class="col-extra whitespace-nowrap">
						{row.acquiredAt ? formatDateShort(row.acquiredAt) : '—'}
					</td>
					<td class="whitespace-nowrap">
						{row.disposedAt ? formatDateShort(row.disposedAt) : '—'}
					</td>
					<td class="whitespace-nowrap">
						{#if row.state === 'overdue'}
							<Badge variant="error" size="sm">
								{m.staff_inventory_compliance_overdue_label({
									value: row.dueBy ? formatDateShort(row.dueBy) : ''
								})}
							</Badge>
						{:else}
							<span class:text-warning={(row.daysRemaining ?? 99) < 30}>
								{row.dueBy ? formatDateShort(row.dueBy) : '—'}
								<span class="text-subtle"
									>{m.staff_inventory_compliance_d_text({
										daysRemaining: row.daysRemaining ?? ''
									})}</span
								>
							</span>
						{/if}
					</td>
					<td class="w-px">
						<RecordForm8282Action assetId={row.id} dueBy={row.dueBy} variant="ghost" />
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={data.rows.length} unit="obligations" />
	{/if}
</PageContent>
