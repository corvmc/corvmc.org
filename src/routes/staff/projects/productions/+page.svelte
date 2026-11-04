<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import NewProductionAction from './NewProductionAction.svelte';
	import ProjectViews from '../ProjectViews.svelte';
	import { formatDate } from '#lib/utils/format.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import AvatarStack from '#lib/components/ui/AvatarStack.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { getStaffEvents } from '#lib/remote/events.remote.js';
	import { Latest } from '#lib/latest.svelte.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';

	/**
	 * The Productions view: the shows CMC puts on, at every status including
	 * `draft`, since this is where a show is built. `/staff/events` is what the
	 * public can see; a published CMC show is on both, in two roles.
	 *
	 * Names `source: 'cmc'` rather than excluding the others, so a source added
	 * later goes visibly missing instead of being silently adopted.
	 */
	const initial = new URLSearchParams(pageState.url.search);

	let page = $state(1);
	let status = $state<'draft' | 'published' | 'cancelled' | ''>(
		(initial.get('status') as 'draft' | 'published' | 'cancelled' | null) ?? ''
	);
	let venueId = $state(initial.get('venue') ?? '');
	let dateFrom = $state(initial.get('from') ?? '');
	let dateTo = $state(initial.get('to') ?? '');
	// "Which shows still need an opener" — the question the panel could not ask
	// at all before a production could state how many acts it wants (#859).
	let needsActs = $state(initial.get('needs') === '1');

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
		if (needsActs) pairs.push(['needs', '1']);
		if (page > 1) pairs.push(['page', String(page)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = withQuery(resolve('staff/projects/productions'), search);
		if (location.pathname + location.search !== href) {
			void goto(href, { replace: true, reset: false });
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
			needsActs: needsActs || undefined,
			page
		})
	);

	type Production = Awaited<typeof result>['rows'][number];

	// The venue filter's options. Not `{#await}`: every filter change re-pended
	// it and remounted the select mid-choice.
	const venues = new Latest(() => result);

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

	const activeCount = $derived(
		(status ? 1 : 0) +
			(venueId ? 1 : 0) +
			(dateFrom ? 1 : 0) +
			(dateTo ? 1 : 0) +
			(needsActs ? 1 : 0)
	);

	function clearFilters() {
		status = '';
		venueId = '';
		dateFrom = '';
		dateTo = '';
		needsActs = false;
		page = 1;
	}
</script>

<PageHeader title={m.staff_projects()}>
	<NewProductionAction />
</PageHeader>
<PageContent>
	<ProjectViews active="productions" />
	<FilterBar {activeCount} onclear={clearFilters}>
		<Select size="sm" aria-label={m.staff_status()} bind:value={status} onchange={() => (page = 1)}>
			<option value="">{m.staff_projects_productions_every_status()}</option>
			<option value="draft">{m.staff_projects_productions_draft()}</option>
			<option value="published">{m.staff_projects_productions_published()}</option>
			<option value="cancelled">{m.staff_cancelled()}</option>
		</Select>
		{#if venues.current}
			{@const data = venues.current}
			<Select
				size="sm"
				aria-label={m.staff_projects_productions_venue()}
				bind:value={venueId}
				onchange={() => (page = 1)}
			>
				<option value="">{m.staff_projects_productions_every_venue()}</option>
				{#each data.venues as v (v.id)}
					<option value={v.id}>{v.name}</option>
				{/each}
			</Select>
		{/if}
		<input
			type="date"
			aria-label={m.staff_projects_productions_from_date()}
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => (page = 1)}
		/>
		<input
			type="date"
			aria-label={m.staff_projects_productions_date()}
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => (page = 1)}
		/>
		<label class="label gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				bind:checked={needsActs}
				onchange={() => (page = 1)}
			/>
			{m.staff_projects_productions_short_bands()}
		</label>
	</FilterBar>

	<DataList {result} empty={m.staff_projects_productions_empty()} onpage={(p) => (page = p)}>
		{#snippet children(events)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"
						><span class="sr-only">{m.staff_projects_productions_listing_status()}</span></th
					>
					<th>{m.staff_event()}</th>
					<!-- Two statuses, two columns, both labelled. The glyph on the left
					     is the listing's — is it on the guide — and this one is the
					     production's — how far through putting it on we are. -->
					<th class="col-support w-px">{m.staff_status()}</th>
					<th class="col-support">{m.staff_projects_productions_lineup()}</th>
					<th class="col-extra">{m.staff_projects_productions_venue()}</th>
					<th class="col-extra">{m.staff_tags()}</th>
				{/snippet}

				{#each events as e, idx (e.id)}
					{@const label = dayLabel(e)}
					{@const prevLabel = idx > 0 ? dayLabel(events[idx - 1]) : null}
					{#if label !== prevLabel}
						<tr>
							<td colspan="6" class="cell-group">
								{label}
							</td>
						</tr>
					{/if}
					{@const href = resolve(`staff/events/${e.id}`)}
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
								<span class="whitespace-nowrap text-base-content/50">{m.staff_no_production()}</span
								>
							{/if}
						</td>
						<td class="col-support whitespace-nowrap">
							{#if e.lineup.count > 0}
								<AvatarStack items={e.lineup.acts} total={e.lineup.count} />
							{:else}
								<span class="opacity-40">—</span>
							{/if}
							<!-- What is still owed on the bill. Without a target there is
							     nothing to be short of, which is why an unset one shows
							     nothing rather than "0 wanted" (#859). -->
							{#if e.lineup.short > 0}
								<Badge variant="warning" size="xs"
									>{m.staff_projects_productions_needs({ short: e.lineup.short })}</Badge
								>
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
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
