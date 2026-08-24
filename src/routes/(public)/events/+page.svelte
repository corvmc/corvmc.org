<script lang="ts">
	import Section from '$lib/components/shared/marketing/Section.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { page } from '$app/state';
	import PosterCard from '$lib/components/shared/events/PosterCard.svelte';
	import MiniCalendar from '$lib/components/public/calendar/MiniCalendar.svelte';
	import GigList from '$lib/components/shared/events/GigList.svelte';
	import { getPublicEvents } from '$lib/remote/events.remote';
	import { getPublicGigGuide } from '$lib/remote/calendar.remote';
	import { toLocalDate } from '$lib/utils/format';
	import type { CalendarEntry } from '$lib/types/calendar';

	const FROM_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
	const today = toLocalDate(new Date());

	// Malformed ?from= params fall back to today before querying.
	const from = $derived.by(() => {
		const param = page.url.searchParams.get('from');
		return param && FROM_RE.test(param) ? param : today;
	});

	let { upcoming } = $derived(await getPublicEvents());
	let guide = $derived(await getPublicGigGuide({ from, offset: 0 }));

	// "Show more" appends pages client-side; reset when the anchor changes.
	let extra: CalendarEntry[] = $state([]);
	let extraHasMore = $state<boolean | null>(null);
	let loadingMore = $state(false);
	let extraFor = $state('');

	const allEvents = $derived(extraFor === from ? [...guide.events, ...extra] : guide.events);
	const hasMore = $derived(
		extraFor === from && extraHasMore !== null ? extraHasMore : guide.hasMore
	);

	async function showMore() {
		loadingMore = true;
		try {
			const next = await getPublicGigGuide({
				from,
				offset: extraFor === from ? guide.events.length + extra.length : guide.events.length
			});
			extra = extraFor === from ? [...extra, ...next.events] : next.events;
			extraFor = from;
			extraHasMore = next.hasMore;
		} finally {
			loadingMore = false;
		}
	}

	let dismissed = $state(false);
	let showNotice = $derived(
		page.url.searchParams.get('notice') === 'no-show-tonight' && !dismissed
	);
</script>

<svelte:head>
	<title>Events | Corvallis Music Collective</title>
	<meta
		name="description"
		content="Shows at the Collective and gigs from our member bands around the region."
	/>
	<meta property="og:title" content="Events | Corvallis Music Collective" />
	<meta
		property="og:description"
		content="Shows at the Collective and gigs from our member bands around the region."
	/>
</svelte:head>

<Section>
	<div class="text-center mb-10">
		<h1 class="text-4xl font-bold tracking-tight mb-2 text-cmc-navy">Events</h1>
		<p class="text-base text-fg-2">
			Shows at the Collective and gigs from our member bands around the region
		</p>
	</div>

	{#if showNotice}
		<div
			class="flex items-center justify-between gap-4 rounded-lg border px-4 py-3 mb-8"
			style="border-color: var(--cmc-navy); color: var(--cmc-navy)"
			role="status"
		>
			<p class="text-sm font-medium">
				No show at the Collective tonight — here's what's coming up.
			</p>
			<button
				type="button"
				class="text-sm font-semibold underline shrink-0"
				onclick={() => (dismissed = true)}
			>
				Dismiss
			</button>
		</div>
	{/if}

	{#if upcoming.length > 0}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-14">
			{#each upcoming as evt (evt.id)}
				<PosterCard
					href="/events/{evt.id}"
					title={evt.title}
					posterUrl={evt.posterUrl}
					startsAt={evt.startsAt}
					ticketingEnabled={evt.ticketingEnabled}
					ticketPrice={evt.ticketPrice}
					externalTicketUrl={evt.externalTicketUrl}
					tags={evt.tags}
				/>
			{/each}
		</div>
	{/if}

	<div class="guide">
		<aside class="guide__side">
			<MiniCalendar anchor={from} />
			{#if from !== today}
				<Button href="/events" variant="ghost" size="sm" class="mt-3">← Back to today</Button>
			{/if}
		</aside>
		<div class="guide__main">
			{#if allEvents.length === 0}
				<div class="text-center py-12 opacity-60">
					<p class="text-base">Nothing on the calendar yet. Check back soon!</p>
				</div>
			{:else}
				<GigList events={allEvents} />
				{#if hasMore}
					<div class="text-center mt-8">
						<Button type="button" variant="ghost" disabled={loadingMore} onclick={showMore}>
							{loadingMore ? 'Loading…' : 'Show more'}
						</Button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</Section>

<style>
	.guide {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.guide__side {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.guide__main {
		flex: 1;
		min-width: 0;
	}

	@media (min-width: 768px) {
		.guide {
			flex-direction: row;
			align-items: flex-start;
		}

		.guide__side {
			position: sticky;
			top: 5rem;
			align-items: flex-start;
		}
	}
</style>
