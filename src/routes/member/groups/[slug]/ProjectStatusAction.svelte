<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { setCommitteeProjectStatusForm } from '$lib/remote/projects.remote';
	import { projectStatusOptions, type ProjectStatus } from '$lib/config';

	/** Move one of the committee's own projects along. Budget and burn stay on the staff page. */
	let { project }: { project: { id: string; name: string; status: ProjectStatus } } = $props();

	const action = $derived(setCommitteeProjectStatusForm.for(project.id));
</script>

<Action
	{action}
	label="Status"
	aria-label={`Change the status of ${project.name}`}
	modalTitle="Change status"
	submitLabel="Save"
	successToast="Status updated"
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.id.as('hidden', project.id)} />
		<Field
			field={action.fields.status}
			type="select"
			label="Status"
			options={projectStatusOptions}
			value={project.status}
		/>
	{/snippet}
</Action>
