<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { rescheduleTaskForm } from '$lib/remote/tasks.remote';
	import { toLocalDate, toLocalDateTime } from '$lib/utils/format';
	import type { Task } from './task-view';

	/**
	 * The window and the deadline, edited together: they are independent, and a
	 * window running past the due date is flagged, not refused. Blank clears.
	 */
	let {
		task,
		projectId,
		label,
		key
	}: { task: Task; projectId: string; label: string; key: string } = $props();

	const edit = $derived(rescheduleTaskForm.for(`${task.id}:${key}`));
</script>

<Action
	action={edit}
	{label}
	variant="ghost"
	size="xs"
	class="justify-start font-normal"
	modalTitle="When: {task.title}"
	submitLabel="Save"
	successToast="Saved"
>
	{#snippet form()}
		<input {...edit.fields.projectId.as('hidden', projectId)} />
		<input {...edit.fields.workOrderId.as('hidden', task.id)} />
		<Field
			field={edit.fields.startsAt}
			type="datetime-local"
			label="Starts"
			value={task.startsAt ? toLocalDateTime(task.startsAt) : ''}
		/>
		<Field
			field={edit.fields.endsAt}
			type="datetime-local"
			label="Ends"
			value={task.endsAt ? toLocalDateTime(task.endsAt) : ''}
			description="A window needs both ends. Clear both to take it off the schedule."
		/>
		<Field
			field={edit.fields.dueAt}
			type="date"
			label="Due"
			value={task.dueAt ? toLocalDate(task.dueAt) : ''}
			description="A deadline, not a window: done by then."
		/>
	{/snippet}
</Action>
