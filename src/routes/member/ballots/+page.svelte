<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** Ballots a member can vote on or certify, drafts of committees they run, and every certified result. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import BallotTable from '#lib/components/ballot/BallotTable.svelte';
	import CreateBallotAction from '#lib/components/ballot/CreateBallotAction.svelte';
	import { getMemberBallots } from '#lib/remote/ballots.remote.js';

	const { ballots, committees } = $derived(await getMemberBallots());
</script>

<PageHeader title={m.member_ballots_title()} subtitle={m.member_member_body()}>
	{#if committees.length > 0}
		<CreateBallotAction kind="group" panel="member" {committees} />
	{/if}
</PageHeader>

<PageContent>
	{#if ballots.length === 0}
		<EmptyState
			title={m.member_ballots_no_ballots_yet_title()}
			description={m.member_ballots_description_body()}
		/>
	{:else}
		<BallotTable rows={ballots} panel="member" />
		<Pagination total={ballots.length} unit="ballots" />
	{/if}
</PageContent>
