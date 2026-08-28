<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import { formatDate } from '$lib/utils/format';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import { getStaffCalendar } from '$lib/remote/events.remote';
	import PendingReviewBadge from './PendingReviewBadge.svelte';

	/**
	 * The staff calendar: the public gig guide, plus what is asking to join it.
	 *
	 * Scoped by status and reading every source, which is what separates it from
	 * `/staff/productions` — that page is scoped to `source='cmc'` and runs the
	 * shows CMC produces. A CMC show is on both, in two roles: something you are
	 * building, and something the public can see.
	 *
	 * It holds `/staff/events` deliberately. That is the address every event ref
	 * resolves to, so it is where a staffer lands by default from anywhere in the
	 * panel — and the general, least-privileged view is what belongs at a default.
	 *
	 * No tabs. The queue is not a separate view of the calendar, it is the
	 * calendar filtered to the rows asking for a decision, so the status filter
	 * is the whole control — the shape `/staff/flags` already uses, down to
	 * counting "not the default" as an active filter.
	 */
	type View = 'review' | 'calendar' | 'rejected' | 'all';

	const STATUSES = {
		review: ['pending_review'],
		calendar: ['published', 'cancelled'],
		rejected: ['rejected'],
		all: ['pending_review', 'published', 'cancelled', 'rejected']
	} as const satisfies Record<View, readonly string[]>;

	// Read once, at mount. A staffer reaches this page from the "listing awaiting
	// review" notification, which links here with no query string at all, so the
	// default has to be the queue rather than the whole calendar.
	const initial = new URLSearchParams(pageState.url.search);
	const initialView = (initial.get('view') ?? 'review') as View;

	let view = $state<View>(initialView in STATUSES ? initialView : 'review');
	let source = $state<'cmc' | 'band' | 'community' | ''>(
		(initial.get('source') as 'cmc' | 'band' | 'community' | null) ?? ''
	);
	let page = $state(1);

	// Writes the URL, never state. `goto(..., { replaceState })` rather than
	// `replaceState()`: the latter updates neither `page.url` nor the router's
	// own state, so backing out of an event landed on the wrong filter.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (view !== 'review') pairs.push(['view', view]);
		if (source) pairs.push(['source', source]);
		if (page > 1) pairs.push(['page', String(page)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/events')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// The page's one query, and a promise rather than an await: `DataList`
	// consumes it with `{#await}`, so changing a filter does not suspend the page
	// into the staff layout boundary's pending snippet. The review count lives in
	// `PendingReviewBadge`, which owns its own query for the same reason.
	const result = $derived(
		getStaffCalendar({
			statuses: [...STATUSES[view]],
			sources: source ? [source] : undefined,
			page
		})
	);

	type CalendarRow = Awaited<typeof result>['rows'][number];

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	function dayLabel(e: CalendarRow): string {
		return formatDate(e.startsAt);
	}

	function clearFilters() {
		view = 'review';
		source = '';
		page = 1;
	}

	const emptyCopy: Record<View, string> = {
		review: 'Nothing waiting on staff',
		calendar: 'Nothing on the calendar yet',
		rejected: 'Nothing has been turned down',
		all: 'No events'
	};
</script>

<PageHeader title="Calendar" subtitle="Staff">
	<PendingReviewBadge />
</PageHeader>
<PageContent>
	<FilterBar activeCount={(view === 'review' ? 0 : 1) + (source ? 1 : 0)} onclear={clearFilters}>
		<Select size="sm" aria-label="Status" bind:value={view} onchange={() => (page = 1)}>
			<option value="review">Needs review</option>
			<option value="calendar">On the calendar</option>
			<option value="rejected">Turned down</option>
			<option value="all">Everything</option>
		</Select>
		<Select size="sm" aria-label="Source" bind:value={source} onchange={() => (page = 1)}>
			<option value="">Every source</option>
			<option value="cmc">CMC</option>
			<option value="band">Bands</option>
			<option value="community">Community</option>
		</Select>
	</FilterBar>

	<DataList {result} empty={emptyCopy[view]} onpage={(p) => (page = p)}>
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
							<td
								colspan="4"
								class="bg-base-200 px-4 py-2 text-subtle font-semibold tracking-wide uppercase"
							>
								{label}
							</td>
						</tr>
					{/if}
					{@const href = resolve(`/staff/events/${e.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={e.status} />
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
