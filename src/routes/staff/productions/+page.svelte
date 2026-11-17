<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import StatusBadge, { statusLabel } from '#lib/components/ui/StatusBadge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import DateFilter from '#lib/components/ui/DateFilter.svelte';
	import { urlState, oneOf, positiveInt, text } from '#lib/urlState.svelte.js';
	import { listDateRanges } from '#lib/config.js';
	import { formatDate } from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import type { ProductionStatus } from '#lib/server/db/schema/production.js';
	import { getStaffProductions } from '#lib/remote/production-list.remote.js';
	import NewProductionAction from './NewProductionAction.svelte';

	// Every production, from draft to closed (#3112). A row opens its event on
	// the Calendar; one with no event yet opens its project. A Record, so a
	// production status added to the schema fails the type check here.
	const statusOrder: Record<ProductionStatus, null> = {
		draft: null,
		offered: null,
		confirmed: null,
		completed: null,
		settled: null,
		closed: null,
		cancelled: null
	};
	const productionStatuses = Object.keys(statusOrder) as ProductionStatus[];

	const filters = urlState(resolve('staff/productions'), {
		status: oneOf<ProductionStatus | ''>(productionStatuses, ''),
		needs: oneOf(['', '1'] as const, ''),
		// Any date by default, so an undated draft stays on the list.
		date: oneOf(listDateRanges, 'any'),
		from: text(),
		to: text(),
		page: positiveInt(1)
	});

	// A promise rather than an await: `DataList` consumes it with `{#await}`.
	const result = $derived(
		getStaffProductions({
			status: filters.status || undefined,
			needsActs: filters.needs === '1' || undefined,
			range: filters.date,
			from: filters.date === 'custom' && filters.from ? filters.from : undefined,
			to: filters.date === 'custom' && filters.to ? filters.to : undefined,
			page: filters.page
		})
	);

	const activeCount = $derived(
		(filters.status ? 1 : 0) + (filters.needs ? 1 : 0) + (filters.date !== 'any' ? 1 : 0)
	);

	function clearFilters() {
		filters.status = '';
		filters.needs = '';
		filters.date = 'any';
		filters.from = '';
		filters.to = '';
		filters.page = 1;
	}
</script>

<PageHeader title={m.staff_productions_title()}>
	<NewProductionAction />
</PageHeader>

<PageContent>
	<FilterBar {activeCount} onclear={clearFilters}>
		<DateFilter
			bind:range={filters.date}
			bind:from={filters.from}
			bind:to={filters.to}
			onchange={() => (filters.page = 1)}
		/>
		<Select
			size="sm"
			aria-label={m.staff_events_production_status_label()}
			bind:value={filters.status}
			onchange={() => (filters.page = 1)}
		>
			<option value="">{m.staff_events_every_production_status_label()}</option>
			{#each productionStatuses as s (s)}
				<option value={s}>{statusLabel(s)}</option>
			{/each}
		</Select>
		<label class="label gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={filters.needs === '1'}
				onchange={(e) => {
					filters.needs = e.currentTarget.checked ? '1' : '';
					filters.page = 1;
				}}
			/>
			{m.staff_projects_productions_short_bands_label()}
		</label>
	</FilterBar>

	<DataList {result} empty={m.staff_productions_empty_body()} onpage={(p) => (filters.page = p)}>
		{#snippet children(rows)}
			<Table>
				{#snippet head()}
					<th class="w-px">{m.staff_status_label()}</th>
					<th>{m.staff_production_label()}</th>
					<th class="col-support">{m.staff_event_label()}</th>
					<th class="col-extra">{m.staff_projects_productions_venue_label()}</th>
				{/snippet}
				{#each rows as r (r.id)}
					{@const href = r.listing
						? resolve(`staff/events/${r.listing.id}`)
						: resolve(`staff/tasks/projects/${r.projectId}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px"><StatusBadge status={r.status} label /></td>
						<td class="cell-primary">
							<a {href} class="font-medium link-hover">{r.name}</a>
							{#if r.startsAt}
								<div class="text-muted text-xs whitespace-nowrap">
									{formatDate(r.startsAt)}
									{#if r.endsAt}· {formatEventTimeRange(r.startsAt, r.endsAt)}{/if}
								</div>
							{/if}
						</td>
						<td class="col-support whitespace-nowrap">
							{#if r.listing}
								<StatusBadge status={r.listing.status} label />
							{:else}
								<span class="text-muted">{m.staff_productions_not_listed_text()}</span>
							{/if}
						</td>
						<td class="col-extra whitespace-nowrap">{r.venueName ?? '—'}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
