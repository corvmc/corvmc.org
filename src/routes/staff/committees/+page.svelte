<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ApplicationsCard from '$lib/components/groups/ApplicationsCard.svelte';
	import { getCommitteeApplicationQueue } from '$lib/remote/group-applications.remote';

	const queue = $derived(getCommitteeApplicationQueue());
</script>

<PageHeader title="Committee applications" subtitle="People" />

<PageContent>
	{#await queue then data}
		{#if data.committees.length === 0}
			<EmptyState description="Nothing waiting on any committee." />
		{:else}
			<!--
				All six in one list rather than a committee per page. A chair reads
				their own on the club page; whoever works this one answers for every
				committee, including the ones with no chair yet.
			-->
			{#each data.committees as committee (committee.id)}
				<ApplicationsCard
					kind="committee"
					slug={committee.slug}
					title={committee.name}
					applications={committee.applications}
				/>
			{/each}
		{/if}
	{/await}
</PageContent>
