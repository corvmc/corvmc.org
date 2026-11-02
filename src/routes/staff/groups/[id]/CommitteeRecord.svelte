<script lang="ts">
	import type { Snippet } from 'svelte';
	import RecordFrame from '$lib/components/ui/RecordFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StaffGroupDetail from '$lib/components/groups/StaffGroupDetail.svelte';
	import ApplicationsCard from '$lib/components/groups/ApplicationsCard.svelte';
	import { getStaffCommitteePage } from '$lib/remote/groups.remote';

	/**
	 * One committee: its applications for whoever reviews them, and the settings,
	 * grants and roster for a `group.read` holder. The volunteer coordinator
	 * reviews applications and manages nothing, so they get the first half only.
	 */
	let {
		id,
		variant = 'page',
		actions
	}: { id: string; variant?: 'page' | 'panel'; actions?: Snippet } = $props();

	const data = $derived(await getStaffCommitteePage(id));
</script>

{#snippet applications()}
	<ApplicationsCard slug={data.committee.slug} kind="committee" applications={data.applications} />
{/snippet}

{#if data.manage}
	<StaffGroupDetail
		group={data.manage.group}
		members={data.manage.members}
		{applications}
		{variant}
		{actions}
	/>
{:else}
	<RecordFrame {variant} {actions} title={data.committee.name} subtitle="Committee">
		{#if data.applications.length === 0}
			<EmptyState description="No open applications." />
		{:else}
			{@render applications()}
		{/if}
	</RecordFrame>
{/if}
