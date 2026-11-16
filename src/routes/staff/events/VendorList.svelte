<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { urlState, positiveInt, oneOf } from '#lib/urlState.svelte.js';
	import { marketVendorStatuses, marketVendorStatusLabels } from '#lib/config.js';
	import { formatDate } from '#lib/utils/format.js';
	import { getStaffVendorApplications } from '#lib/remote/market.remote.js';
	import EventViewFilter from './EventViewFilter.svelte';

	/**
	 * Every market's vendor applications, latest market first (#2766). Deciding
	 * stays on each market's vendors page, which the row opens.
	 */
	const filters = urlState(resolve('staff/events'), {
		// Always written: it is what keeps the address on this view.
		view: { default: '', parse: () => 'vendors', encode: (v: string) => v },
		status: oneOf<(typeof marketVendorStatuses)[number] | ''>(marketVendorStatuses, ''),
		page: positiveInt(1)
	});

	const result = $derived(
		getStaffVendorApplications({ status: filters.status || undefined, page: filters.page })
	);
</script>

<FilterBar
	activeCount={filters.status ? 1 : 0}
	onclear={() => {
		filters.status = '';
		filters.page = 1;
	}}
>
	<EventViewFilter view="vendors" />
	<Select
		size="sm"
		aria-label={m.staff_status_label()}
		value={filters.status}
		onchange={(e: Event) => {
			filters.status = (e.currentTarget as HTMLSelectElement).value as typeof filters.status;
			filters.page = 1;
		}}
	>
		<option value="">{m.ui_list_filters_all_statuses_label()}</option>
		{#each marketVendorStatuses as s (s)}
			<option value={s}>{marketVendorStatusLabels[s]}</option>
		{/each}
	</Select>
</FilterBar>

<DataList {result} empty={m.staff_events_vendors_empty_body()} onpage={(p) => (filters.page = p)}>
	{#snippet children(rows)}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
				<th>{m.staff_events_id_vendors_vendor_label()}</th>
				<th class="col-support">{m.staff_event_label()}</th>
				<th class="col-extra">{m.staff_events_vendors_applied_label()}</th>
			{/snippet}
			{#each rows as v (v.id)}
				{@const href = resolve('/staff/events/[id]/vendors', { id: v.eventId })}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px"><StatusBadge status={v.status} /></td>
					<td class="cell-primary">
						<div class="font-medium">{v.businessName}</div>
						<div class="text-muted text-sm">{v.offering}</div>
					</td>
					<td class="col-support">
						<div>{v.eventTitle}</div>
						<div class="text-muted text-sm">{formatDate(v.eventStartsAt)}</div>
					</td>
					<td class="col-extra whitespace-nowrap">{formatDate(v.createdAt)}</td>
				</tr>
			{/each}
		</Table>
	{/snippet}
</DataList>
