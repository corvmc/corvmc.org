<script lang="ts">
	import InboxViews from './InboxViews.svelte';
	import InboxChannelFilter from './InboxChannelFilter.svelte';
	/**
	 * The staff queue: view tabs, search, and the list of conversations.
	 *
	 * Lifted out of `+page.svelte` into the layout so it survives opening a
	 * thread. Every `/staff/inbox/[id]` URL still resolves — those are deep-linked
	 * from notification emails, the in-app bell and the staff user record.
	 *
	 * The filters themselves live in `filters.svelte.ts`, shared with the panel
	 * that edits them: that panel renders in the *other* pane, so the two are
	 * siblings rather than parent and child.
	 */
	import { untrack } from 'svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import DataList from '$lib/components/ui/DataList.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { IconFilter, IconX } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatDateTime } from '$lib/utils/format';
	import { getInboxThreads } from '$lib/remote/inbox.remote';
	import { channelIcon, channelLabel } from '$lib/components/inbox/channels';
	import {
		openReason,
		threadDisplayStatus,
		waitingDays
	} from '$lib/components/inbox/thread-status';
	import { queueVersion } from '$lib/components/inbox/queue.svelte';
	import {
		filters,
		filterPanel,
		seedFromUrl,
		toSearch,
		toQuery,
		activeCount,
		reset
	} from './filters.svelte';

	// Seeded once, from the URL this component mounted on. Re-seeding on every
	// navigation would fight the mirror below: opening a thread carries the query
	// string along, and re-reading it is a no-op at best and a race at worst.
	seedFromUrl(page.url.searchParams);

	let searchText = $state(filters.search);

	// Writes the URL, never state — the filters stay the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router then overwrites that entry with
	// its own record on the next navigation, so back from a thread landed on the
	// unfiltered list.
	//
	// Mirrored onto the CURRENT pathname, not a hard-coded `/staff/inbox`. This
	// component lives in the layout, so it keeps running while a thread is open —
	// pinned to the index path it would `goto` straight back to the list the
	// moment you opened anything. Carrying the query onto the thread URL is also
	// what makes back return to the same filtered view.
	$effect(() => {
		const search = toSearch();
		const href = `${page.url.pathname}${search ? `?${search}` : ''}`;
		if (page.url.pathname + page.url.search !== href) {
			// Already a real pathname off `page.url`, so there is nothing to resolve.
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// The component's one query. The filter controls each own theirs — none of
	// them is keyed by these filters, and each has mutations that refresh it by
	// name.
	const result = $derived(getInboxThreads(toQuery()));

	// Disposing of a thread from the pane beside this one moves it between views,
	// and no mutation can name this instance to refresh it — see queue.svelte.ts.
	// `untrack` because the derived above already refetches on a filter change;
	// reading the filters here as a dependency would fire a second request.
	$effect(() => {
		if (queueVersion() === 0) return;
		untrack(() => void getInboxThreads(toQuery()).refresh());
	});

	const openId = $derived(page.params.id);

	// Mirrors the views listThreads sorts by `waitingSince`. Saying "6 days"
	// beside a row whose order came from `lastMessageAt` would be two different
	// clocks in one line.
	const sortedByWaiting = $derived(filters.view === 'open' || filters.view === 'snoozed');

	const formatWait = (days: number) => (days === 0 ? 'today' : `${days}d`);
</script>

<div class="flex min-h-0 flex-col gap-2">
	<InboxViews
		bind:view={filters.view}
		onchange={() => {
			filters.page = 1;
		}}
	/>

	<!-- One row in a 20rem pane: the two buttons drop to their icons below `@md`,
	     which is every width where the conversation sits beside this. -->
	<div class="flex flex-wrap items-center gap-2">
		<div class="min-w-32 flex-1">
			<SearchInput
				bind:value={searchText}
				placeholder="Search conversations…"
				onsearch={(q) => {
					filters.search = q;
					filters.page = 1;
				}}
			/>
		</div>
		<!-- The channel filter stays inline: it is the one facet that answers
		     "where did this come from", which is a different question from the
		     panel's "what am I working on". -->
		<InboxChannelFilter
			value={filters.channel}
			onselect={(channel) => {
				filters.channel = channel;
				filters.page = 1;
			}}
		/>
		<Button
			variant={filterPanel.open ? 'primary' : 'default'}
			size="sm"
			aria-label={activeCount() ? `Filters, ${activeCount()} active` : 'Filters'}
			onclick={() => (filterPanel.open = !filterPanel.open)}
		>
			<IconFilter size={16} /> <span class="hidden @md:inline">Filters</span>
			{#if activeCount()}<Badge class="ml-1">{activeCount()}</Badge>{/if}
		</Button>
		{#if activeCount()}
			<Button variant="ghost" size="sm" onclick={reset} aria-label="Clear filters">
				<IconX size={16} />
			</Button>
		{/if}
	</div>

	{#if sortedByWaiting}
		<!-- The order is not obvious from the rows, and an unexplained order reads
		     as an arbitrary one. -->
		<p class="text-subtle text-xs">Sorted by longest waiting</p>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto">
		<DataList
			{result}
			empty={filters.view === 'open'
				? 'Nothing open — the queue is clear.'
				: filters.view === 'snoozed'
					? 'Nothing is waiting on a date or a reply.'
					: 'No conversations found'}
			onpage={(p) => (filters.page = p)}
		>
			{#snippet children(threads)}
				<ul class="flex flex-col gap-1">
					{#each threads as t (t.id)}
						{@const href = resolve(`/staff/inbox/${t.id}`)}
						{@const Icon = channelIcon(t.channel)}
						{@const active = t.id === openId}
						{@const who = t.contactName ?? t.contactEmail ?? t.contactPhone ?? null}
						{@const reason = openReason(t)}
						<li>
							<a
								{href}
								class="flex items-start gap-2.5 rounded-box p-2 hover:bg-base-200 {active
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
										<!-- `label` throughout: every one of these badges is the reason
										     the row is in front of you, and an icon-only badge says
										     nothing. On the Open view that reason is *why* it is open
										     (never answered, they replied, the snooze ran out); on the
										     others it is the status itself, which the tab no longer
										     repeats — Snoozed holds both kinds of parked, so the badge
										     is the only thing saying which one a row is, and when a
										     snoozed one is due back.

										     `shrink-0` because it is a phrase: left to shrink it wraps
										     "Snooze expired" onto two lines and takes the row's height with
										     it. The name beside it is the part that truncates. -->
										{#if reason}
											<StatusBadge status={reason} label class="shrink-0" />
										{:else}
											{@const display = threadDisplayStatus(t)}
											<StatusBadge
												status={display}
												label
												class="shrink-0"
												text={display === 'snoozed' && t.snoozedUntil
													? `Snoozed · ${formatDateShort(t.snoozedUntil)}`
													: undefined}
											/>
										{/if}

										<!-- The age rides the name line rather than a fourth one. On the
										     views sorted by wait it *is* the wait: `waitingSince` collapses
										     to `lastMessageAt` there, so "3 weeks ago · 20d" was the same
										     fact twice. Elsewhere the exact day beats a relative phrase in a
										     right-hand column, and the title carries the rest. -->
										<span
											class="ml-auto shrink-0 text-subtle text-xs"
											title={t.lastMessageAt ? formatDateTime(t.lastMessageAt) : undefined}
										>
											{#if sortedByWaiting}
												{formatWait(waitingDays(t))}
											{:else}
												{t.lastMessageAt ? formatDateShort(t.lastMessageAt) : '—'}
											{/if}
										</span>
									</span>

									{#if t.subject && who}
										<span class="truncate text-sm">{t.subject}</span>
									{/if}
									{#if t.preview}
										<span class="truncate text-muted text-sm">{t.preview}</span>
									{/if}

									<!-- Only when there is one. An unassigned thread has nothing to say
									     here, and an empty line said it four rows at a time. -->
									{#if t.assignedToName}
										<span class="truncate text-subtle text-xs">{t.assignedToName}</span>
									{/if}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/snippet}
		</DataList>
	</div>
</div>
