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
	let venueId = $state(initial.get('venue') ?? '');
	let dateFrom = $state(initial.get('from') ?? '');
	let dateTo = $state(initial.get('to') ?? '');

	// Writes the URL, never state — the filters above stay the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router overwrites that entry on the next
	// navigation, so back from an event landed on the wrong filter.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (status) pairs.push(['status', status]);
		if (venueId) pairs.push(['venue', venueId]);
		if (dateFrom) pairs.push(['from', dateFrom]);
		if (dateTo) pairs.push(['to', dateTo]);
		if (page > 1) pairs.push(['page', String(page)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/productions')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// The page's one query, and still a promise rather than an await: `DataList`
	// consumes it with `{#await}` so a filter change does not suspend the page
	// into the layout boundary's pending snippet. The venue, the production and
	// the bill all ride along inside it — see `getStaffEvents`.
	const result = $derived(
		getStaffEvents({
			source: 'cmc',
			status: status || undefined,
			venueId: venueId || undefined,
			dateFrom: dateFrom || undefined,
			dateTo: dateTo || undefined,
			page
		})
	);

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

	/** "Sunbathers +2", or nothing at all when the bill is empty. */
	function lineupLabel(e: Production): string | null {
		if (!e.lineup.headliner) return null;
		const rest = e.lineup.count - 1;
		return rest > 0 ? `${e.lineup.headliner} +${rest}` : e.lineup.headliner;
	}

	const activeCount = $derived(
		(status ? 1 : 0) + (venueId ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)
	);

	function clearFilters() {
		status = '';
		venueId = '';
		dateFrom = '';
		dateTo = '';
		page = 1;
	}
</script>

<PageHeader title="Productions" subtitle="Staff">
	<Button variant="default" size="sm" onclick={() => (showCreateModal = true)}>New Event</Button>
</PageHeader>
<PageContent>
	<CreateEventModal bind:open={showCreateModal} />

	<FilterBar {activeCount} onclear={clearFilters}>
		<Select size="sm" aria-label="Status" bind:value={status} onchange={() => (page = 1)}>
			<option value="">Every status</option>
			<option value="draft">Draft</option>
			<option value="published">Published</option>
			<option value="cancelled">Cancelled</option>
		</Select>
		{#await result then data}
			<Select size="sm" aria-label="Venue" bind:value={venueId} onchange={() => (page = 1)}>
				<option value="">Every venue</option>
				{#each data.venues as v (v.id)}
					<option value={v.id}>{v.name}</option>
				{/each}
			</Select>
		{/await}
		<input
			type="date"
			aria-label="From date"
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => (page = 1)}
		/>
		<input
			type="date"
			aria-label="To date"
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => (page = 1)}
		/>
	</FilterBar>

	<DataList {result} empty="No events yet" onpage={(p) => (page = p)}>
		{#snippet children(events)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Listing status</span></th>
					<th>Event</th>
					<!-- Two statuses, two columns, both labelled. The glyph on the left
					     is the listing's — is it on the guide — and this one is the
					     production's — how far through putting it on we are. -->
					<th class="col-support w-px">Production</th>
					<th class="col-support">Lineup</th>
					<th class="col-extra">Venue</th>
					<th class="col-extra">Tags</th>
					<th class="col-support w-px">Space</th>
				{/snippet}

				{#each events as e, idx (e.id)}
					{@const label = dayLabel(e)}
					{@const prevLabel = idx > 0 ? dayLabel(events[idx - 1]) : null}
					{#if label !== prevLabel}
						<tr>
							<td colspan="7" class="cell-group">
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
						<td class="col-support w-px">
							{#if e.productionStatus}
								<StatusBadge status={e.productionStatus} label />
							{:else}
								<span class="whitespace-nowrap text-base-content/50">No production</span>
							{/if}
						</td>
						<td class="col-support">
							{#if lineupLabel(e)}
								{lineupLabel(e)}
							{:else}
								<span class="opacity-40">—</span>
							{/if}
						</td>
						<td class="col-extra">
							{#if e.venueName}
								<span class="whitespace-nowrap">{e.venueName}</span>
							{:else}
								<span class="opacity-40">—</span>
							{/if}
						</td>
						<td class="col-extra">
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
