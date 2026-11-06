<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import WorkOrderView from '#lib/components/volunteer/WorkOrderView.svelte';
	import { getProjectTaskPage } from '#lib/remote/tasks.remote.js';
	import { getProjectActivity } from '#lib/remote/projects.remote.js';
	import ActivityCard from '#lib/components/project/ActivityCard.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id', 'taskId');

	/** A project's task, as the shift page shows a work order, under its project. */
	const view = $derived(
		await getProjectTaskPage({ projectId: params.id, workOrderId: params.taskId })
	);
	const projectHref = $derived(resolve(`staff/projects/${view.project.id}`));
</script>

<WorkOrderView
	{view}
	subtitle={m.staff_task()}
	parent={[{ label: view.project.name, href: withQuery(projectHref, `task=${view.shift.id}`) }]}
>
	{#snippet context()}
		<a href={projectHref} class="link link-primary">{view.project.name}</a>
	{/snippet}
	{#snippet activity()}
		{@const ids = { projectId: view.project.id, workOrderId: view.shift.id }}
		<ActivityCard query={(limit) => getProjectActivity(limit ? { ...ids, limit } : ids)} />
	{/snippet}
</WorkOrderView>
