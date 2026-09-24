<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { createCommitteeProjectWorkOrderForm } from '$lib/remote/projects.remote';

	/** Open unscheduled work on one of the committee's own projects. */
	let {
		project,
		roles
	}: {
		project: { id: string; name: string };
		roles: { value: string; label: string }[];
	} = $props();

	const action = $derived(createCommitteeProjectWorkOrderForm.for(project.id));
</script>

<Action
	{action}
	label="Work order"
	aria-label={`Open a work order on ${project.name}`}
	modalTitle="Open a work order on {project.name}"
	submitLabel="Open"
	successToast="Work order opened"
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.projectId.as('hidden', project.id)} />
		<Field field={action.fields.volunteerRoleId} type="select" label="Role" options={roles} />
		<Field
			field={action.fields.notes}
			type="textarea"
			label="What needs doing"
			description="It opens unscheduled. A volunteer coordinator finds it a time."
		/>
		<Field field={action.fields.dueAt} type="date" label="Due by" />
	{/snippet}
</Action>
