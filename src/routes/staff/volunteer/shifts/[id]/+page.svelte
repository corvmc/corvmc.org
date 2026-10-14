<script lang="ts">
	import { page } from '$app/state';
	import WorkOrderView from '$lib/components/volunteer/WorkOrderView.svelte';
	import { getStaffShiftPage, getWorkOrderActivity } from '$lib/remote/volunteer.remote';
	import ActivityCard from '$lib/components/project/ActivityCard.svelte';

	/** Work on no project; a project's work order is redirected to its task page. */
	const view = $derived(await getStaffShiftPage(page.params.id!));
</script>

<WorkOrderView {view} subtitle="Shift" backHref="/staff/volunteer/schedule">
	{#snippet activity()}
		{@const ids = { workOrderId: view.shift.id }}
		<ActivityCard query={(limit) => getWorkOrderActivity(limit ? { ...ids, limit } : ids)} />
	{/snippet}
</WorkOrderView>
