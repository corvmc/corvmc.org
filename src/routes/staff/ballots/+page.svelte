<script lang="ts">
	/** Every ballot, newest first, with the two ways to start one. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import BallotTable from '$lib/components/ballot/BallotTable.svelte';
	import CreateBallotAction from '$lib/components/ballot/CreateBallotAction.svelte';
	import { getStaffBallots } from '$lib/remote/ballots.remote';

	const { ballots, committees } = $derived(await getStaffBallots());
</script>

<PageHeader title="Ballots" subtitle="People">
	{#if committees.length > 0}
		<CreateBallotAction kind="group" panel="staff" {committees} />
	{/if}
	<CreateBallotAction kind="member" panel="staff" />
</PageHeader>

<PageContent>
	{#if ballots.length === 0}
		<EmptyState
			title="No ballots yet"
			description="Start a member-wide ballot, or a committee ballot on behalf of a committee."
		/>
	{:else}
		<BallotTable rows={ballots} panel="staff" />
		<Pagination total={ballots.length} unit="ballots" />
	{/if}
</PageContent>
