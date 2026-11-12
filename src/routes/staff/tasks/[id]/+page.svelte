<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import WorkOrderView from '#lib/components/volunteer/WorkOrderView.svelte';
	import { getTaskPage, getWorkOrderActivity } from '#lib/remote/volunteer.remote.js';
	import { getProjectActivity } from '#lib/remote/projects.remote.js';
	import ActivityCard from '#lib/components/project/ActivityCard.svelte';
	import EngageContractorAction from './EngageContractorAction.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/** Every task, in a project or none (#2625); a task in a project names it as a crumb. */
	const view = $derived(await getTaskPage(params.id));
	const project = $derived(view.project);
	const projectHref = $derived(
		project ? resolve('/staff/tasks/projects/[id]', { id: project.id }) : null
	);
</script>

<WorkOrderView
	{view}
	subtitle={m.staff_task_body()}
	parent={project && projectHref ? [{ label: project.name, href: projectHref }] : []}
	context={project ? projectLink : undefined}
>
	{#snippet actions()}
		{#if view.contractors.length > 0 && !view.task.cancelledAt && !view.task.resolvedAt}
			<EngageContractorAction workOrderId={view.task.id} contractors={view.contractors} />
		{/if}
	{/snippet}
	{#snippet activity()}
		{#if project}
			{@const ids = { projectId: project.id, workOrderId: view.task.id }}
			<ActivityCard query={(limit) => getProjectActivity(limit ? { ...ids, limit } : ids)} />
		{:else}
			{@const ids = { workOrderId: view.task.id }}
			<ActivityCard query={(limit) => getWorkOrderActivity(limit ? { ...ids, limit } : ids)} />
		{/if}
	{/snippet}
</WorkOrderView>

{#snippet projectLink()}
	{#if project && projectHref}
		<a href={projectHref} class="link link-primary">{project.name}</a>
	{/if}
{/snippet}
