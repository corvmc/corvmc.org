<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import WorkOrderView from '$lib/components/volunteer/WorkOrderView.svelte';
	import { getStaffShiftPage, getWorkOrderActivity } from '$lib/remote/volunteer.remote';
	import ActivityCard from '$lib/components/project/ActivityCard.svelte';

	/** Work on no project; a project's work order is redirected to its task page. */
	const view = $derived(await getStaffShiftPage(page.params.id!));
</script>

<!-- Under Volunteering by URL, but reached from the schedule, which the URL does not say. -->
<WorkOrderView
	{view}
	subtitle="Shift"
	parent={[{ label: 'Schedule', href: resolve('/staff/volunteer/schedule') }]}
>
	{#snippet activity()}
		{@const ids = { workOrderId: view.shift.id }}
		<ActivityCard query={(limit) => getWorkOrderActivity(limit ? { ...ids, limit } : ids)} />
	{/snippet}
</WorkOrderView>
