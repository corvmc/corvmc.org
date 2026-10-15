<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import WorkOrderView from '$lib/components/volunteer/WorkOrderView.svelte';
	import { getProjectTaskPage } from '$lib/remote/tasks.remote';
	import { getProjectActivity } from '$lib/remote/projects.remote';
	import ActivityCard from '$lib/components/project/ActivityCard.svelte';

	/** A project's task, as the shift page shows a work order, under its project. */
	const view = $derived(
		await getProjectTaskPage({ projectId: page.params.id!, workOrderId: page.params.taskId! })
	);
	const projectHref = $derived(resolve(`/staff/projects/${view.project.id}`));
</script>

<WorkOrderView
	{view}
	subtitle="Task"
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
