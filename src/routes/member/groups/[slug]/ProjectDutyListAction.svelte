<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { applyDutyListToProjectForm } from '$lib/remote/projects.remote';
	import { toastWarnings } from '$lib/utils/toast-warnings';

	/** Stamp one of the project templates into the committee's own project. */
	let {
		project,
		dutyLists
	}: {
		project: { id: string; name: string };
		dutyLists: { id: string; name: string }[];
	} = $props();

	const action = $derived(applyDutyListToProjectForm.for(project.id));
	const options = $derived(dutyLists.map((l) => ({ value: l.id, label: l.name })));
</script>

<Action
	{action}
	label="Apply template"
	aria-label={`Apply a template to ${project.name}`}
	modalTitle="Apply a template to {project.name}"
	submitLabel="Apply"
	successToast="Work orders created"
	onsuccess={toastWarnings}
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.projectId.as('hidden', project.id)} />
		<Field field={action.fields.dutyListId} type="select" label="Template" {options} />
		<Field field={action.fields.reason} type="text" label="Reason, if applying again" />
	{/snippet}
</Action>
