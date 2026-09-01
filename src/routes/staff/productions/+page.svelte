<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import CreateEventModal from './CreateEventModal.svelte';
	import { formatDate } from '$lib/utils/format';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { getStaffEvents } from '$lib/remote/events.remote';
	import { formatEventTimeRange } from '$lib/utils/event-time';

	/**
	 * Productions: the shows CMC puts on, at every stage of putting them on.
	 *
	 * Scoped to `source: 'cmc'` and reading every status, including `draft` —
	 * this is the surface where a show is *built*, so a half-written one belongs
	 * here and nowhere else. What the public can see, across every source, is
	 * `/staff/events`; a published CMC show is on both pages, in two roles.
	 *
	 * Naming the source rather than excluding the others is deliberate. An
	 * exclusion filter silently adopts every source added later — Groups adds a
	 * fourth for club sessions — where naming it means a new source goes visibly
	 * missing instead, which is the failure you want.
	 */
	const initial = new URLSearchParams(pageState.url.search);

	let page = $state(1);
	let showCreateModal = $state(false);
	let status = $state<'draft' | 'published' | 'cancelled' | ''>(
		(initial.get('status') as 'draft' | 'published' | 'cancelled' | null) ?? ''
	);

	// Writes the URL, never state — the filter above stays the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router overwrites that entry on the next
	// navigation, so back from an event landed on the wrong filter.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (status) pairs.push(['status', status]);
		if (page > 1) pairs.push(['page', String(page)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/productions')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// The page's one query, and still a promise rather than an await: `DataList`
	// consumes it with `{#await}` so a filter change does not suspend the page
	// into the layout boundary's pending snippet.
	const result = $derived(getStaffEvents({ source: 'cmc', status: status || undefined, page }));

	type Production = Awaited<typeof result>['rows'][number];

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	function dayLabel(e: Production): string {
		return formatDate(e.startsAt);
	}

	function clearFilters() {
		status = '';
		page = 1;
	}
</script>

<PageHeader title="Productions" subtitle="Staff">
	<Button variant="default" size="sm" onclick={() => (showCreateModal = true)}>New Event</Button>
</PageHeader>
<PageContent>
	<CreateEventModal bind:open={showCreateModal} />

	<FilterBar activeCount={status ? 1 : 0} onclear={clearFilters}>
		<Select size="sm" aria-label="Status" bind:value={status} onchange={() => (page = 1)}>
			<option value="">Every status</option>
			<option value="draft">Draft</option>
			<option value="published">Published</option>
			<option value="cancelled">Cancelled</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No events yet" onpage={(p) => (page = p)}>
		{#snippet children(events)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Event</th>
					<th class="col-support">Tags</th>
					<th class="col-support w-px">Space</th>
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
						<td class="col-support">
							<div class="flex flex-wrap gap-1">
								{#each parseTags(e.tags) as tag (tag)}
									<Badge size="sm" variant="outline">{tag}</Badge>
								{/each}
							</div>
						</td>
						<!--
							Promoted from `col-extra` to `col-support`: an unheld room is the
							characteristic failure of a production, and hiding it below 768px
							is how a calendar of shows once reached production with none
							booked. The Source column it replaces only ever said "CMC".
						-->
						<td class="col-support w-px">
							{#if e.reservationId}
								<Badge size="sm" variant="info">Reserved</Badge>
							{:else}
								<span class="opacity-40">—</span>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
