<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StaffGroupDetail from '$lib/components/groups/StaffGroupDetail.svelte';
	import ApplicationsCard from '$lib/components/groups/ApplicationsCard.svelte';
	import { getStaffCommitteePage } from '$lib/remote/groups.remote';

	/**
	 * One committee: its applications for whoever reviews them, and the settings,
	 * grants and roster for a `group.read` holder. The volunteer coordinator
	 * reviews applications and manages nothing, so they get the first half only.
	 */
	let id = $derived(page.params.id!);
	const data = $derived(await getStaffCommitteePage(id));
</script>

{#snippet applications()}
	<ApplicationsCard slug={data.committee.slug} kind="committee" applications={data.applications} />
{/snippet}

{#if data.manage}
	<StaffGroupDetail group={data.manage.group} members={data.manage.members} {applications} />
{:else}
	<PageHeader
		width="3xl"
		title={data.committee.name}
		subtitle="Committee"
		backHref="/staff/committees"
	/>
	<PageContent width="3xl">
		{#if data.applications.length === 0}
			<EmptyState description="Nothing waiting on this committee." />
		{:else}
			{@render applications()}
		{/if}
	</PageContent>
{/if}
