<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import PosterCard from '$lib/components/events/PosterCard.svelte';
	import GigList from '$lib/components/events/GigList.svelte';
	import TicketStub from '$lib/components/events/TicketStub.svelte';
	import TicketQRModal from '$lib/components/events/TicketQRModal.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import Carousel from '$lib/components/ui/Carousel.svelte';
	import ButtonGroup from '$lib/components/ui/ButtonGroup.svelte';
	import { tagToTapeVariant } from '$lib/utils/tag-colors';
	import { getMemberEventsPage } from '$lib/remote/events.remote';
	// Still needed on its own for the lazy "show more" pager, which is not a fan-out.
	import { getPublicGigGuide } from '$lib/remote/calendar.remote';
	import MyListingsSection from './MyListingsSection.svelte';
	import { resolve } from '$app/paths';
	import type { CalendarEntry } from '$lib/types/calendar';

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
		location: string | null;
		source: string;
		status: string;
	}

	const pageData = $derived(await getMemberEventsPage());
	const { upcoming, past }: { upcoming: EventItem[]; past: EventItem[] } = $derived(
		pageData.events
	);
	const tickets = $derived(pageData.tickets);
	const guide = $derived(pageData.guide);

	// "Show more" appends pages client-side, the same pager `/events` uses.
	let extra: CalendarEntry[] = $state([]);
	let extraHasMore = $state<boolean | null>(null);
	let loadingMore = $state(false);

	const allEvents = $derived([...guide.events, ...extra]);
	const hasMore = $derived(extraHasMore !== null ? extraHasMore : guide.hasMore);
	const remaining = $derived(Math.max(0, guide.total - allEvents.length));

	async function showMore() {
		loadingMore = true;
		try {
			const next = await getPublicGigGuide({ offset: allEvents.length });
			extra = [...extra, ...next.events];
			extraHasMore = next.hasMore;
		} finally {
			loadingMore = false;
		}
	}

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
	<MyListingsSection />

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

	<!-- Hidden outright when the Collective has nothing on. An empty-state under
	     a poster grid said "no upcoming events" while the gig guide below it
	     listed a dozen (#1025). -->
	{#if upcoming.length > 0}
		<section>
			<SectionLabel label="At the Collective" count={upcoming.length} />

			{#if allTags.length > 1}
				<div class="mb-4">
					<ButtonGroup wrap>
						<Button
							variant={activeFilter === null ? 'primary' : 'default'}
							size="sm"
							class="join-item {activeFilter === null ? 'latched' : ''}"
							onclick={() => (activeFilter = null)}
						>
							All <span class="ml-1 opacity-60">{upcoming.length}</span>
						</Button>
						{#each allTags as tag (tag)}
							<Button
								variant={activeFilter === tag ? 'primary' : 'default'}
								size="sm"
								class="join-item {activeFilter === tag ? 'latched' : ''}"
								onclick={() => (activeFilter = activeFilter === tag ? null : tag)}
							>
								{tag}
								<span class="ml-1 opacity-60">
									{upcoming.filter((e) => e.tags?.split(',').some((t) => t.trim() === tag)).length}
								</span>
							</Button>
						{/each}
					</ButtonGroup>
				</div>
			{/if}

			<!-- Posters over the dense reader, the pairing `/events` uses. The member
			     saw the same shows through a flat run of ~490px cards — one per
			     screen-and-a-half on a phone (#1055). -->
			<div class="pgrid">
				{#each filteredEvents.slice(0, 3) as evt (evt.id)}
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
		</section>
	{/if}

	<!-- The same gig guide the public calendar shows, so a member reads one
	     calendar rather than the subset we happen to produce (#1025). -->
	<section>
		<SectionLabel label="Around town" count={guide.total} />
		{#if allEvents.length === 0}
			<div class="py-8 text-center opacity-60">
				<p class="text-base">Nothing on the calendar yet. Check back soon!</p>
			</div>
		{:else}
			<GigList events={allEvents} eventBase="/member/events" bandBase="/member/directory/bands" />
			{#if hasMore}
				<div class="mt-8 text-center">
					<Button type="button" variant="ghost" disabled={loadingMore} onclick={showMore}>
						{loadingMore ? 'Loading…' : `Show more (${remaining} left)`}
					</Button>
				</div>
			{/if}
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
