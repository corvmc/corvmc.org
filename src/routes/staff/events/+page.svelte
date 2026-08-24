<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/shared/entity';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import CreateEventModal from './CreateEventModal.svelte';
	import { formatDate } from '$lib/utils/format';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import { getStaffEvents } from '$lib/remote/events.remote';
	import { getPendingSubmissionCount } from '$lib/remote/community-events.remote';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import { formatEventTimeRange } from '$lib/utils/event-time';

	// Read once, at mount: the notification a staffer follows links straight to
	// ?status=pending_review, and landing on the All tab would make that link a
	// lie.
	const initial = new URLSearchParams(pageState.url.search);

	let page = $state(1);
	let showCreateModal = $state(false);
	let source = $state<'cmc' | 'band' | 'community' | ''>(
		(initial.get('source') as 'cmc' | 'band' | 'community' | null) ?? ''
	);
	let view = $state<'all' | 'review'>(
		initial.get('status') === 'pending_review' ? 'review' : 'all'
	);

	// Writes the URL, never state — the tab above stays the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router overwrites that entry on the next
	// navigation, so back from an event landed on the wrong tab.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (view === 'review') pairs.push(['status', 'pending_review']);
		if (source) pairs.push(['source', source]);
		if (page > 1) pairs.push(['page', String(page)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/events')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// The review queue is exactly `pending_review`, never `draft` — a member's
	// unfinished listing is not staff's to read, and listAll holds those back.
	let result = $derived(
		getStaffEvents({
			source: source || undefined,
			status: view === 'review' ? 'pending_review' : undefined,
			page
		})
	);

	let pendingCount = $derived(await getPendingSubmissionCount());

	type Event = Awaited<typeof result>['rows'][number];

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	function dayLabel(e: Event): string {
		return formatDate(e.startsAt);
	}

	function clearFilters() {
		source = '';
		page = 1;
	}
</script>

<PageHeader title="Events">
	<Button variant="default" size="sm" onclick={() => (showCreateModal = true)}>New Event</Button>
</PageHeader>
<PageContent>
	<CreateEventModal bind:open={showCreateModal} />

	<TabBar
		tabs={[
			{ key: 'all', label: 'All events' },
			{ key: 'review', label: 'Needs review', badge: pendingCount || undefined }
		]}
		active={view}
		onchange={(k) => {
			view = k as 'all' | 'review';
			page = 1;
		}}
	/>

	<FilterBar activeCount={source ? 1 : 0} onclear={clearFilters}>
		<Select size="sm" aria-label="Source" bind:value={source} onchange={() => (page = 1)}>
			<option value="">All events</option>
			<option value="cmc">CMC events</option>
			<option value="band">Band events</option>
			<option value="community">Community listings</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No events yet" onpage={(p) => (page = p)}>
		{#snippet children(events)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Event</th>
					<th class="col-support">Source</th>
					<th class="col-support">Tags</th>
					<th class="col-extra w-px">Space</th>
				{/snippet}

				{#each events as e, idx (e.id)}
					{@const label = dayLabel(e)}
					{@const prevLabel = idx > 0 ? dayLabel(events[idx - 1]) : null}
					{#if label !== prevLabel}
						<tr>
							<td
								colspan="5"
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
							The managing band, which used to link to the *public* directory
							from inside the staff panel — the split `entityHref` exists to
							close. The collective's own shows have no band to name.
						-->
						<td class="col-support">
							{#if e.source === 'band'}
								<EntityChip ref={e.band} />
							{:else}
								<span class="text-muted">CMC</span>
							{/if}
						</td>
						<td class="col-support">
							<div class="flex flex-wrap gap-1">
								{#each parseTags(e.tags) as tag (tag)}
									<Badge size="sm" variant="outline">{tag}</Badge>
								{/each}
							</div>
						</td>
						<td class="col-extra w-px">
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
