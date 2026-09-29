<script lang="ts">
	import { page } from '$app/state';
	import StaffGroupDetail from '$lib/components/groups/StaffGroupDetail.svelte';
	import ApplicationsCard from '$lib/components/groups/ApplicationsCard.svelte';
	import { getStaffGroupPage } from '$lib/remote/groups.remote';

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffGroupPage(id));
</script>

<!-- Only for the club's own owner or admin: `group.read` alone answers nothing (#1730). -->
{#snippet applications()}
	{#if data.canReviewApplications}
		<ApplicationsCard slug={data.group.slug} kind="club" applications={data.applications} />
	{/if}
{/snippet}

<StaffGroupDetail group={data.group} members={data.members} {applications} />
