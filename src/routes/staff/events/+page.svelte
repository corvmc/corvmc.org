<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '#lib/components/ui/entity/index.js';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { urlState, positiveInt, oneOf, text } from '#lib/urlState.svelte.js';
	import { eventSources, listDateRanges, type EventSource } from '#lib/config.js';
	import ListFilters from '#lib/components/ui/ListFilters.svelte';
	import { formatDate } from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { getStaffCalendar, getStaffCalendarTotals } from '#lib/remote/events.remote.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import CalendarTotals from './CalendarTotals.svelte';
	import CreateListingAction from './CreateListingAction.svelte';
	import { Latest } from '#lib/latest.svelte.js';

	type Status = keyof Awaited<ReturnType<typeof getStaffCalendar>>['statusCounts'];
	// A Record, so a status added to the schema fails the type check until it has a label.
	const statusLabel: Record<Status, (count: number) => string> = {
		draft: (count) => m.staff_events_status_draft_label({ count }),
		pending_review: (count) => m.staff_events_status_pending_review_label({ count }),
		published: (count) => m.staff_events_status_published_label({ count }),
		rejected: (count) => m.staff_events_status_rejected_label({ count }),
		cancelled: (count) => m.staff_events_status_cancelled_label({ count })
	};
	const statuses = Object.keys(statusLabel) as Status[];
	const sourceLabel: Record<EventSource, () => string> = {
		cmc: m.staff_events_source_cmc_label,
		band: m.staff_events_source_band_label,
		community: m.staff_events_source_community_label,
		group: m.staff_events_source_group_label
	};

	/**
	 * Every listing staff may see, with the Practice space list's filter row. It
	 * opens on From today, soonest first; the totals above ignore the filters.
	 */
	const filters = urlState(resolve('staff/events'), {
		source: oneOf<EventSource | ''>(eventSources, ''),
		q: text(),
		date: oneOf(listDateRanges, 'from_today'),
		from: text(),
		to: text(),
		status: oneOf<Status | ''>(statuses, ''),
		page: positiveInt(1)
	});

	// A promise rather than an await: `DataList` consumes it with `{#await}`, so
	// paging does not suspend the page into the staff layout's pending snippet.
	const result = $derived(
		getStaffCalendar({
			source: filters.source || undefined,
			q: filters.q || undefined,
			range: filters.date,
			from: filters.date === 'custom' && filters.from ? filters.from : undefined,
			to: filters.date === 'custom' && filters.to ? filters.to : undefined,
			status: filters.status || undefined,
			page: filters.page
		})
	);
	// Latched so the status counts do not blank while the next page loads.
	const latest = new Latest(() => result);
	const statusCounts = $derived(latest.current?.statusCounts);

	type CalendarRow = Awaited<typeof result>['rows'][number];

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	const dayLabel = (e: CalendarRow) => formatDate(e.startsAt);
</script>

<PageHeader title={m.staff_events_title()} subtitle={m.staff_staff_body()}>
	<CreateListingAction />
</PageHeader>
<PageContent>
	<svelte:boundary>
		<CalendarTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffCalendarTotals(), reset)}>
				{m.staff_events_calendar_totals_didn_t_load_body()}
			</Alert>
		{/snippet}
	</svelte:boundary>

	<ListFilters
		types={eventSources.map((s) => ({ value: s, label: sourceLabel[s]() }))}
		typeAllLabel={m.staff_events_all_sources_label()}
		typeLabel={m.staff_events_source_label()}
		bind:type={filters.source}
		searchPlaceholder={m.staff_events_search_placeholder()}
		bind:search={filters.q}
		bind:range={filters.date}
		bind:from={filters.from}
		bind:to={filters.to}
		statuses={statuses.map((s) => ({ value: s, label: statusLabel[s](statusCounts?.[s] ?? 0) }))}
		bind:status={filters.status}
		bind:page={filters.page}
	/>

	<DataList {result} empty={m.staff_events_empty_body()} onpage={(p) => (filters.page = p)}>
		{#snippet children(events)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_event_label()}</th>
					<th class="col-support">{m.staff_posted_by_label()}</th>
					<th class="col-extra">{m.staff_tags_label()}</th>
				{/snippet}

				{#each events as e, idx (e.id)}
					{@const label = dayLabel(e)}
					{@const prevLabel = idx > 0 ? dayLabel(events[idx - 1]) : null}
					{#if label !== prevLabel}
						<tr>
							<td colspan="4" class="cell-group">
								{label}
							</td>
						</tr>
					{/if}
					{@const href = resolve(`staff/events/${e.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={e.status} label={e.status === 'pending_review'} />
						</td>
						<!-- The day is in the group header, so the cell carries the title
						     and just the time range. -->
						<td class="cell-primary">
							<EntityIdentity ref={e.ref}>
								{#snippet subtitle()}
									<span class="whitespace-nowrap">
										{formatEventTimeRange(e.startsAt, e.endsAt)}
									</span>
								{/snippet}
							</EntityIdentity>
						</td>
						<!--
							Who is accountable for the row, which is a different record per
							source: the band manages its own gig, a member owns their listing,
							and the collective's own shows answer with neither. One column,
							three answers — it replaces the old Source column, which only ever
							said "CMC" or repeated the band.
						-->
						<td class="col-support">
							{#if e.source === 'cmc'}
								<span class="text-muted">{m.staff_cmc_text()}</span>
							{:else if e.source === 'band'}
								<EntityChip ref={e.band} />
							{:else}
								<EntityChip ref={e.submitter} />
							{/if}
						</td>
						<td class="col-extra">
							<div class="flex flex-wrap gap-1">
								{#each parseTags(e.tags) as tag (tag)}
									<Badge size="sm" variant="outline">{tag}</Badge>
								{/each}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
