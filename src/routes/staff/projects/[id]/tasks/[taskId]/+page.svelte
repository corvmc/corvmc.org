<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import WorkOrderView from '$lib/components/volunteer/WorkOrderView.svelte';
	import { getProjectTaskPage } from '$lib/remote/tasks.remote';

	/** A project's task, as the shift page shows a work order, under its project. */
	const view = $derived(
		await getProjectTaskPage({ projectId: page.params.id!, workOrderId: page.params.taskId! })
	);
	const projectHref = $derived(resolve(`/staff/projects/${view.project.id}`));
</script>

<WorkOrderView {view} subtitle="Task" backHref="{projectHref}?task={view.shift.id}">
	{#snippet context()}
		<a href={projectHref} class="link link-primary">{view.project.name}</a>
	{/snippet}
</WorkOrderView>
