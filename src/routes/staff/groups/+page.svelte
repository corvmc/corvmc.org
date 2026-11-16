<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { page } from '$app/state';
	import { groupView } from './views';
	import BandList from './BandList.svelte';
	import ClubList from './ClubList.svelte';
	import CommitteeList from './CommitteeList.svelte';

	// Each view seeds its filters from the URL at mount, so a change of kind remounts.
	const view = $derived(groupView(page.url.searchParams));
</script>

<PageHeader title={m.staff_groups_title()} />

<PageContent>
	{#key view}
		{#if view === 'club'}
			<ClubList />
		{:else if view === 'committee'}
			<CommitteeList />
		{:else}
			<BandList />
		{/if}
	{/key}
</PageContent>
