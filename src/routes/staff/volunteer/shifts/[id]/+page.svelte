<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import WorkOrderView from '#lib/components/volunteer/WorkOrderView.svelte';
	import { getStaffShiftPage, getWorkOrderActivity } from '#lib/remote/volunteer.remote.js';
	import ActivityCard from '#lib/components/project/ActivityCard.svelte';
	import EngageContractorAction from './EngageContractorAction.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/** Work on no project; a project's work order is redirected to its task page. */
	const view = $derived(await getStaffShiftPage(params.id));
</script>

<!-- Under Volunteering by URL, but reached from the schedule, which the URL does not say. -->
<WorkOrderView
	{view}
	subtitle={m.staff_task_body()}
	parent={[{ label: m.staff_schedule_label(), href: resolve('staff/volunteer/schedule') }]}
>
	{#snippet actions()}
		{#if view.contractors.length > 0 && !view.task.cancelledAt && !view.task.resolvedAt}
			<EngageContractorAction workOrderId={view.task.id} contractors={view.contractors} />
		{/if}
	{/snippet}
	{#snippet activity()}
		{@const ids = { workOrderId: view.task.id }}
		<ActivityCard query={(limit) => getWorkOrderActivity(limit ? { ...ids, limit } : ids)} />
	{/snippet}
</WorkOrderView>
