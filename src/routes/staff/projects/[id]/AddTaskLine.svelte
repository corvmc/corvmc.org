<script lang="ts">
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { createTaskForm } from '$lib/remote/tasks.remote';
	import InlineAddField from './InlineAddField.svelte';

	/** Type a title, press Enter: a task with nothing else set, at the foot of its section. */
	let {
		projectId,
		sectionId,
		sectionName
	}: { projectId: string; sectionId: string | null; sectionName: string } = $props();

	const add = $derived(createTaskForm.for(sectionId ?? 'loose'));
</script>

<Form remote={add} onsuccess={() => add.fields.title.set('')}>
	<input {...add.fields.projectId.as('hidden', projectId)} />
	<input {...add.fields.sectionId.as('hidden', sectionId ?? '')} />
	<InlineAddField
		field={add.fields.title}
		label="Add a task to {sectionName}"
		placeholder="Add a task"
	/>
</Form>
