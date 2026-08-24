<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import PosterCard from '$lib/components/shared/events/PosterCard.svelte';
	import TicketStub from '$lib/components/shared/events/TicketStub.svelte';
	import TicketQRModal from '$lib/components/shared/events/TicketQRModal.svelte';
	import SectionLabel from '$lib/components/shared/SectionLabel.svelte';
	import Carousel from '$lib/components/shared/Carousel.svelte';
	import ButtonGroup from '$lib/components/shared/ButtonGroup.svelte';
	import { tagToTapeVariant } from '$lib/utils/tag-colors';
	import { getMemberEvents, getMemberTickets } from '$lib/remote/events.remote';
	import { getMyListings } from '$lib/remote/community-events.remote';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';

	interface EventItem {
		id: string;
		title: string;
		startsAt: Date;
		/** Null when unknown — common on backfilled band gigs. */
		endsAt: Date | null;
		doorsAt: Date | null;
		tags: string | null;
		ticketingEnabled: boolean;
		ticketPrice: number | null;
		externalTicketUrl: string | null;
		posterUrl: string | null;
	}

	let { upcoming, past }: { upcoming: EventItem[]; past: EventItem[] } = $derived(
		await getMemberEvents()
	);
	let tickets = $derived(await getMemberTickets());
	let mine = $derived(await getMyListings());

	const activeTickets = $derived(
		tickets.filter((t) => t.event && t.event.startsAt > new Date() && t.status !== 'cancelled')
	);

	const ticketedEventIds = $derived(new Set(activeTickets.map((t) => t.eventId)));

	const eventTagMap = $derived(new Map(upcoming.map((e) => [e.id, e.tags])));

	const allTags = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local accumulator within a pure $derived, not reactive state
		const tags = new Set<string>();
		for (const evt of upcoming) {
			if (evt.tags) {
				for (const t of evt.tags.split(',')) {
					const trimmed = t.trim();
					if (trimmed) tags.add(trimmed);
				}
			}
		}
		return [...tags];
	});

	let activeFilter = $state<string | null>(null);
	let qrOpen = $state(false);
	let selectedEventId = $state<string | null>(null);
	let selectedIndex = $state(0);

	const selectedTickets = $derived(
		selectedEventId ? activeTickets.filter((t) => t.eventId === selectedEventId) : []
	);

	const filteredEvents = $derived(
		activeFilter
			? upcoming.filter((e) => {
					if (!e.tags) return false;
					return e.tags.split(',').some((t) => t.trim() === activeFilter);
				})
			: upcoming
	);

	function primaryTag(tags: string | null | undefined): string | undefined {
		if (!tags) return undefined;
		return tags.split(',')[0]?.trim() || undefined;
	}
</script>

<PageHeader title="Events">
	<Button href={resolve('/member/events/submit')} variant="primary" size="sm">Add a show</Button>
</PageHeader>
<PageContent>
	<section>
		<SectionLabel label="Your listings" count={mine.listings.length + mine.rejected.length} />

		{#if mine.standing.status !== 'none'}
			<Alert type="info" class="mb-4">
				Staff check your listings before they go on the public calendar.
			</Alert>
		{/if}

		{#if mine.listings.length === 0 && mine.rejected.length === 0}
			<EmptyState
				title="You haven't added any shows"
				description="Know about a gig around town? Put it on the calendar so the rest of the scene finds out."
				actionLabel="Add a show"
				actionHref={resolve('/member/events/submit')}
			/>
		{:else}
			<ul class="mlist">
				<!-- Returned listings lead: they're the ones waiting on the member. -->
				{#each [...mine.rejected, ...mine.listings] as row (row.id)}
					<li>
						<a href={resolve(`/member/events/${row.id}/manage`)} class="mlist__row">
							<StatusBadge status={row.status} />
							<span class="mlist__title">{row.title}</span>
							<span class="mlist__meta">
								{formatDateShort(row.startsAt)}{row.location ? ` · ${row.location}` : ''}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if activeTickets.length > 0}
		<section>
			<SectionLabel label="My Tickets" count={activeTickets.length} />
			<Carousel itemCount={activeTickets.length} cardWidth={360}>
				{#each activeTickets as ticket (ticket.id)}
					<TicketStub
						{ticket}
						tags={eventTagMap.get(ticket.eventId) ?? null}
						onclick={() => {
							selectedEventId = ticket.eventId;
							const siblings = activeTickets.filter((t) => t.eventId === ticket.eventId);
							selectedIndex = siblings.indexOf(ticket);
							qrOpen = true;
						}}
					/>
				{/each}
			</Carousel>
		</section>
	{/if}

	<section>
		<SectionLabel label="Upcoming" count={filteredEvents.length} />

		{#if allTags.length > 1}
			<div class="mb-4">
				<ButtonGroup wrap>
					<Button
						variant={activeFilter === null ? 'primary' : 'default'}
						size="sm"
						class="join-item {activeFilter === null ? 'latched' : ''}"
						onclick={() => (activeFilter = null)}
					>
						All <span class="opacity-60 ml-1">{upcoming.length}</span>
					</Button>
					{#each allTags as tag (tag)}
						<Button
							variant={activeFilter === tag ? 'primary' : 'default'}
							size="sm"
							class="join-item {activeFilter === tag ? 'latched' : ''}"
							onclick={() => (activeFilter = activeFilter === tag ? null : tag)}
						>
							{tag}
							<span class="opacity-60 ml-1">
								{upcoming.filter((e) => e.tags?.split(',').some((t) => t.trim() === tag)).length}
							</span>
						</Button>
					{/each}
				</ButtonGroup>
			</div>
		{/if}

		{#if filteredEvents.length === 0}
			<div class="text-center py-8 opacity-60">
				<p class="text-base">No upcoming events right now. Check back soon!</p>
			</div>
		{:else}
			<div class="pgrid">
				{#each filteredEvents as evt (evt.id)}
					<PosterCard
						href="/member/events/{evt.id}"
						title={evt.title}
						posterUrl={evt.posterUrl}
						startsAt={evt.startsAt}
						ticketingEnabled={evt.ticketingEnabled}
						ticketPrice={evt.ticketPrice}
						externalTicketUrl={evt.externalTicketUrl}
						tags={evt.tags}
						tapeLabel={primaryTag(evt.tags)}
						tapeColor={primaryTag(evt.tags) ? tagToTapeVariant(primaryTag(evt.tags)!) : ''}
						hasTicket={ticketedEventIds.has(evt.id)}
						class="w-full"
					/>
				{/each}
			</div>
		{/if}
	</section>

	{#if past.length > 0}
		<section>
			<SectionLabel label="Past Events" count={past.length} />
			<div class="pgrid">
				{#each past as evt (evt.id)}
					<PosterCard
						href="/member/events/{evt.id}"
						title={evt.title}
						posterUrl={evt.posterUrl}
						startsAt={evt.startsAt}
						ticketingEnabled={evt.ticketingEnabled}
						ticketPrice={evt.ticketPrice}
						externalTicketUrl={evt.externalTicketUrl}
						tags={evt.tags}
						tapeLabel={primaryTag(evt.tags)}
						tapeColor={primaryTag(evt.tags) ? tagToTapeVariant(primaryTag(evt.tags)!) : ''}
						class="w-full opacity-75"
					/>
				{/each}
			</div>
		</section>
	{/if}

	{#if selectedTickets.length > 0}
		<TicketQRModal bind:open={qrOpen} tickets={selectedTickets} initialIndex={selectedIndex} />
	{/if}
</PageContent>

<style>
	.mlist {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.mlist__row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--surface-border);
		border-radius: 6px;
		text-decoration: none;
		color: inherit;
	}
	.mlist__row:hover {
		border-color: var(--cmc-orange);
	}
	.mlist__title {
		font-weight: 500;
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mlist__meta {
		font-size: 0.8rem;
		color: var(--fg-2);
		white-space: nowrap;
	}
</style>
