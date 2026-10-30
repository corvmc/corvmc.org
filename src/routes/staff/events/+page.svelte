<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { urlState, positiveInt } from '$lib/urlState.svelte';
	import { formatDate } from '$lib/utils/format';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import { getStaffCalendar, getStaffCalendarTotals } from '$lib/remote/events.remote';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { retryQuery } from '$lib/utils/retry-query';
	import CalendarTotals from './CalendarTotals.svelte';
	import CreateListingAction from './CreateListingAction.svelte';

	/**
	 * The staff calendar: every listing staff may see, newest first, with no
	 * filters. Listings waiting on staff are pinned above the dates with a
	 * labelled badge; the totals above count them. The Productions view on Projects runs the shows CMC produces.
	 */
	const filters = urlState(resolve('/staff/events'), { page: positiveInt(1) });

	// A promise rather than an await: `DataList` consumes it with `{#await}`, so
	// paging does not suspend the page into the staff layout's pending snippet.
	const result = $derived(getStaffCalendar({ page: filters.page }));

	type CalendarRow = Awaited<typeof result>['rows'][number];

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	// Pending rows arrive pinned first, so they form one group above the dates.
	function dayLabel(e: CalendarRow): string {
		return e.status === 'pending_review' ? 'Pending Listings' : formatDate(e.startsAt);
	}
</script>

<PageHeader title="Calendar" subtitle="Staff">
	<CreateListingAction />
</PageHeader>
<PageContent>
	<svelte:boundary>
		<CalendarTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffCalendarTotals(), reset)}>
				The calendar totals didn't load. The table below is unaffected.
			</Alert>
		{/snippet}
	</svelte:boundary>

	<DataList {result} empty="No events" onpage={(p) => (filters.page = p)}>
		{#snippet children(events)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Event</th>
					<th class="col-support">Posted by</th>
					<th class="col-extra">Tags</th>
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
					{@const href = resolve(`/staff/events/${e.id}`)}
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
								<span class="text-muted">CMC</span>
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
