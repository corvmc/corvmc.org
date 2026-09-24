<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { applyDutyListToProjectForm } from '$lib/remote/projects.remote';

	/** Stamp one of the committee's duty lists onto its own project. */
	let {
		project,
		dutyLists
	}: {
		project: { id: string; name: string; startsAt: Date | null };
		dutyLists: { id: string; name: string }[];
	} = $props();

	const action = $derived(applyDutyListToProjectForm.for(project.id));
	const options = $derived(dutyLists.map((l) => ({ value: l.id, label: l.name })));
</script>

<Action
	{action}
	label="Duty list"
	aria-label={`Apply a duty list to ${project.name}`}
	modalTitle="Apply a duty list to {project.name}"
	submitLabel="Apply"
	successToast="Work orders created"
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.projectId.as('hidden', project.id)} />
		{#if project.startsAt}
			<Field
				field={action.fields.dutyListId}
				type="select"
				label="Duty list"
				{options}
				description="Creates every work order the list describes, timed from the project's start date. Applying the same list twice is refused."
			/>
		{:else}
			<Alert type="warning">
				This project has no start date. Ask staff to set one before applying a duty list.
			</Alert>
		{/if}
	{/snippet}
</Action>
