<script lang="ts">
	import CommitteeApplicationsCard from '$lib/components/groups/CommitteeApplicationsCard.svelte';
	import { getCommitteeApplicationsFor } from '$lib/remote/committee-applications.remote';

	// Its own query, loaded after the page paints: the page's one load-bearing
	// query is `getStaffGroupPage`, and this one wants a capability that one does not.
	let { groupId }: { groupId: string } = $props();

	const applications = $derived(getCommitteeApplicationsFor({ groupId }));
</script>

{#await applications then data}
	<CommitteeApplicationsCard slug={data.slug} applications={data.applications} />
{/await}
