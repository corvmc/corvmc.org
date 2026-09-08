<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import BandReservationCard from '$lib/components/reservations/BandReservationCard.svelte';
	import { getBandReservationsPage } from '$lib/remote/reservations.remote';
	import CreateModal from './CreateModal.svelte';
	import { getBandLayoutContext } from '../layout-context';
	import { page } from '$app/state';

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	// One query. Membership and contact are still resolved before render and handed down, so
	// the step components stay synchronous — they just arrive on the same request now.
	const page_ = $derived(await getBandReservationsPage(page.params.slug!));
	const data = $derived(page_.reservations);
	const membership = $derived(page_.membership);
	const contact = $derived(page_.contact);
	const upcoming = $derived(data.upcoming);
	const past = $derived(data.past);
	const band = $derived(layout.band);
	let activeTab = $state<'upcoming' | 'past'>('upcoming');

	/**
	 * Nothing here refreshes `getBandReservations` by hand, and that is deliberate.
	 *
	 * `Form` submits through `remote.enhance`, and SvelteKit's single-flight
	 * update already re-fetches every query this page is using once the
	 * submission lands — `getBandReservations` included. Calling `.refresh()` from
	 * `onsuccess` on top of that put two concurrent runs on the one cached Query
	 * instance, and the loser left the derived reading a stale value (Svelte
	 * reports it as `derived_inert`). The booking was written, the server sent it
	 * back on both responses, and the list still said "No upcoming sessions" until
	 * the page was reloaded.
	 *
	 * Rare enough to look like a flake and common enough to hit a real member: it
	 * took a loaded machine to reproduce, where it failed 3 runs in 5.
	 * `e2e/band-reservations.e2e.ts` is the regression test.
	 */
</script>

<PageHeader title="Reservations" subtitle={band.name}>
	<CreateModal
		slug={band.slug}
		hasSustainingMember={membership.hasSustainingMember}
		needsPhone={contact.needsPhone}
	/>
</PageHeader>
<PageContent width="2xl">
	<TabBar
		tabs={[
			{ key: 'upcoming', label: `Upcoming (${upcoming.length})` },
			{ key: 'past', label: 'Past' }
		]}
		active={activeTab}
		onchange={(key) => (activeTab = key as 'upcoming' | 'past')}
	/>

	{#if activeTab === 'upcoming'}
		{#if upcoming.length === 0}
			<EmptyState
				title="No upcoming sessions"
				description="Book the practice space and it'll show up here for the whole act."
			/>
		{:else}
			<div>
				{#each upcoming as res (res.id)}
					<BandReservationCard reservation={res} slug={band.slug} />
				{/each}
			</div>
		{/if}
	{/if}

	{#if activeTab === 'past'}
		{#if past.length === 0}
			<EmptyState message="No past reservations." />
		{:else}
			<div>
				{#each past as res (res.id)}
					<BandReservationCard reservation={res} slug={band.slug} />
				{/each}
			</div>
		{/if}
	{/if}
</PageContent>
