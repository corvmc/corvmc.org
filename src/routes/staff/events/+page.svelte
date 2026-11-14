<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { page } from '$app/state';
	import { eventView } from './views';
	import CreateListingAction from './CreateListingAction.svelte';
	import EventList from './EventList.svelte';
	import ProductionList from './ProductionList.svelte';
	import VenueList from './VenueList.svelte';
	import VendorList from './VendorList.svelte';

	// Each view seeds its filters from the URL at mount, so a change of view remounts.
	const view = $derived(eventView(page.url.searchParams));
</script>

<PageHeader title={m.staff_events_title()}>
	{#if view === 'listings'}
		<CreateListingAction />
	{/if}
</PageHeader>

<PageContent>
	{#key view}
		{#if view === 'productions'}
			<ProductionList />
		{:else if view === 'venues'}
			<VenueList />
		{:else if view === 'vendors'}
			<VendorList />
		{:else}
			<EventList />
		{/if}
	{/key}
</PageContent>
