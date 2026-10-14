<script lang="ts">
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { addDutyForm, setDutyDoneForm } from '$lib/remote/tasks.remote';
	import InlineAddField from './InlineAddField.svelte';
	import type { Task } from './task-view';

	/** A task's duties, ticked on change rather than behind a Save, and an add line. */
	let {
		task,
		projectId,
		place
	}: {
		task: Task;
		projectId: string;
		/** A form instance binds to one `<form>`; the row and the panel each need their own. */
		place: 'row' | 'panel';
	} = $props();

	const add = $derived(addDutyForm.for(`${place}:${task.id}`));
	const submitOnChange = (e: Event) => (e.currentTarget as HTMLFormElement).requestSubmit();
</script>

<ul class="space-y-1">
	{#each task.dutyItems as d (d.id)}
		{@const tick = setDutyDoneForm.for(`${place}:${d.id}`)}
		<li>
			<Form remote={tick} onchange={submitOnChange}>
				<input {...tick.fields.projectId.as('hidden', projectId)} />
				<input {...tick.fields.workOrderId.as('hidden', task.id)} />
				<input {...tick.fields.dutyId.as('hidden', d.id)} />
				<FormField
					field={tick.fields.done}
					type="checkbox"
					checkboxLabel={d.label}
					value={d.done}
					class="py-0 {d.done ? 'text-subtle line-through' : ''}"
				/>
			</Form>
		</li>
	{/each}
</ul>
{#if !task.cancelledAt}
	<Form remote={add} onsuccess={() => add.fields.label.set('')}>
		<input {...add.fields.projectId.as('hidden', projectId)} />
		<input {...add.fields.workOrderId.as('hidden', task.id)} />
		<InlineAddField
			field={add.fields.label}
			label="Add a duty to {task.title}"
			placeholder="Add a duty"
		/>
	</Form>
{/if}
