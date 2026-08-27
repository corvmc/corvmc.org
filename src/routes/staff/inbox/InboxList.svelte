<script lang="ts">
	import InboxStatusTabs from './InboxStatusTabs.svelte';
	import InboxChannelOptions from './InboxChannelOptions.svelte';
	import InboxStaffOptions from './InboxStaffOptions.svelte';
	/**
	 * The staff queue: status tabs, filters, and the list of conversations.
	 *
	 * Lifted out of `+page.svelte` into the layout so it survives opening a
	 * thread. Every `/staff/inbox/[id]` URL still resolves — those are deep-linked
	 * from notification emails, the in-app bell and the staff user record.
	 */
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { resolve } from '$app/paths';
	import { relativeDay } from '$lib/utils/format';
	import { inboxChannels } from '$lib/config';
	import { getInboxThreads } from '$lib/remote/inbox.remote';
	import { channelIcon, channelLabel } from '$lib/components/inbox/channels';
	import { threadDisplayStatus } from '$lib/components/inbox/thread-status';

	type StatusView = 'open' | 'snoozed' | 'resolved' | 'all';
	const statusViews: StatusView[] = ['open', 'snoozed', 'resolved', 'all'];

	// Filter state is seeded from the query string and mirrored back into it, so
	// opening a thread and pressing back lands on the same filtered view instead
	// of page 1 of the default one. The state is local rather than read back out
	// of `page.url` so a filter change re-renders immediately instead of waiting
	// on the navigation that mirrors it.
	//
	// The mirror replaces the history entry rather than pushing one: tweaking a
	// filter should not sit between the list and the thread you open from it.
	const initial = page.url.searchParams;
	const parseStatus = (raw: string | null): StatusView =>
		statusViews.includes(raw as StatusView) ? (raw as StatusView) : 'open';

	let statusView = $state(parseStatus(initial.get('status')));
	let channelFilter = $state(initial.get('channel') ?? '');
	let assignedFilter = $state(initial.get('assigned') ?? '');
	// '' | 'yes' (waiting on them) | 'no' (waiting on us).
	let waitingFilter = $state(initial.get('waiting') ?? '');
	// `searchText` (not `search`): FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state(initial.get('q') ?? '');
	let searchQuery = $state(initial.get('q') ?? '');
	let pageNumber = $state(Number(initial.get('page') ?? '1') || 1);

	// Writes the URL, never state — the filters above stay the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router then overwrites that entry with
	// its own record on the next navigation, so back from a thread landed on the
	// unfiltered list.
	//
	// Mirrored onto the CURRENT pathname, not a hard-coded `/staff/inbox`. This
	// component now lives in the layout, so it keeps running while a thread is
	// open — pinned to the index path it would `goto` straight back to the list
	// the moment you opened anything. Carrying the query onto the thread URL is
	// also what makes back return to the same filtered view.
	$effect(() => {
		// Pairs rather than URLSearchParams: the lint rule bans mutable instances of
		// it, and defaults are simply left out so a clean view has a clean URL.
		const pairs: [string, string][] = [];
		if (statusView !== 'open') pairs.push(['status', statusView]);
		if (channelFilter) pairs.push(['channel', channelFilter]);
		if (assignedFilter) pairs.push(['assigned', assignedFilter]);
		if (waitingFilter) pairs.push(['waiting', waitingFilter]);
		if (searchQuery) pairs.push(['q', searchQuery]);
		if (pageNumber > 1) pairs.push(['page', String(pageNumber)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${page.url.pathname}${search ? `?${search}` : ''}`;
		if (page.url.pathname + page.url.search !== href) {
			// Already a real pathname off `page.url`, so there is nothing to resolve.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	let filters = $derived({
		search: searchQuery || undefined,
		status: statusView === 'all' ? undefined : statusView,
		channel: (channelFilter || undefined) as (typeof inboxChannels)[number] | undefined,
		assigned: assignedFilter || undefined,
		awaiting: (waitingFilter || undefined) as 'yes' | 'no' | undefined,
		page: pageNumber
	});

	// The component's one query. The three filter controls each own theirs — none of them is
	// keyed by these filters, and all three have mutations that refresh them by name.
	const result = $derived(getInboxThreads(filters));

	const openId = $derived(page.params.id);

	// The status view is a view, not a filter — it always has a value, so counting
	// it would leave "Clear" permanently offered.
	const activeFilterCount = $derived(
		(searchQuery ? 1 : 0) +
			(channelFilter ? 1 : 0) +
			(assignedFilter ? 1 : 0) +
			(waitingFilter ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchQuery = '';
		channelFilter = '';
		assignedFilter = '';
		waitingFilter = '';
		pageNumber = 1;
	}
</script>

<div class="flex min-h-0 flex-col gap-3">
	<h1 class="text-xl font-bold">Inbox</h1>

	<InboxStatusTabs
		bind:view={statusView}
		onchange={() => {
			pageNumber = 1;
		}}
	/>

	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search..."
				onsearch={(q) => {
					searchQuery = q;
					pageNumber = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Channel"
			value={channelFilter}
			onchange={(e: Event) => {
				channelFilter = (e.currentTarget as HTMLSelectElement).value;
				pageNumber = 1;
			}}
		>
			<InboxChannelOptions current={channelFilter} />
		</Select>
		<Select
			size="sm"
			aria-label="Assigned to"
			value={assignedFilter}
			onchange={(e: Event) => {
				assignedFilter = (e.currentTarget as HTMLSelectElement).value;
				pageNumber = 1;
			}}
		>
			<InboxStaffOptions />
		</Select>
		<!-- Which side the ball is on. Awaiting threads stay in the Open tab, so
		     this is how staff narrow it down to what they still owe an answer. -->
		<Select
			size="sm"
			aria-label="Waiting on"
			value={waitingFilter}
			onchange={(e: Event) => {
				waitingFilter = (e.currentTarget as HTMLSelectElement).value;
				pageNumber = 1;
			}}
		>
			<option value="">Waiting on anyone</option>
			<option value="no">Needs a reply</option>
			<option value="yes">Awaiting their reply</option>
		</Select>
	</FilterBar>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<DataList
			{result}
			empty={statusView === 'open'
				? 'Nothing open — the queue is clear.'
				: 'No conversations found'}
			onpage={(p) => (pageNumber = p)}
		>
			{#snippet children(threads)}
				<ul class="flex flex-col gap-1">
					{#each threads as t (t.id)}
						{@const href = resolve(`/staff/inbox/${t.id}`)}
						{@const Icon = channelIcon(t.channel)}
						{@const active = t.id === openId}
						{@const who = t.contactName ?? t.contactEmail ?? t.contactPhone ?? null}
						<li>
							<a
								{href}
								class="flex items-start gap-3 rounded-box p-3 hover:bg-base-200 {active
									? 'bg-base-200'
									: ''}"
								aria-current={active ? 'page' : undefined}
							>
								<span class="mt-0.5 shrink-0 opacity-60" title={channelLabel(t.channel)}>
									<Icon size={18} />
								</span>

								<span class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="flex items-center gap-2">
										<!-- A portal thread has no denormalised contact — the member is a
										     participant row, and `listThreads` cannot join them live the
										     way `getThread` does without multiplying a flagged direct
										     thread's two member rows. So fall back to the subject rather
										     than heading the row with a dash. -->
										<span class="truncate font-medium">
											{who ?? t.subject ?? channelLabel(t.channel)}
										</span>
										<!-- `label`: "Awaiting reply" is the whole point of the marker,
										     and an icon-only badge would say nothing. -->
										<StatusBadge status={threadDisplayStatus(t)} label />
									</span>

									{#if t.subject && who}
										<span class="truncate text-sm">{t.subject}</span>
									{/if}
									{#if t.preview}
										<span class="truncate text-muted text-sm">{t.preview}</span>
									{/if}

									<span class="text-subtle text-xs">
										{t.lastMessageAt ? relativeDay(t.lastMessageAt) : '—'}
										{#if t.assignedToName}· {t.assignedToName}{/if}
									</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/snippet}
		</DataList>
	</div>
</div>
