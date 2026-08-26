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
	import { getMemberEventsPage } from '$lib/remote/events.remote';
	import MyListingsSection from './MyListingsSection.svelte';
	import { resolve } from '$app/paths';

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

	const pageData = $derived(await getMemberEventsPage());
	const { upcoming, past }: { upcoming: EventItem[]; past: EventItem[] } = $derived(
		pageData.events
	);
	const tickets = $derived(pageData.tickets);

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
