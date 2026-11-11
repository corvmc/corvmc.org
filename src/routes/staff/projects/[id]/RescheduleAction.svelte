<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { rescheduleTaskForm } from '#lib/remote/tasks.remote.js';
	import { toLocalDate, toLocalDateTime } from '#lib/utils/format.js';
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
	modalTitle={m.staff_projects_id_reschedule_modal_title({ title: task.title })}
	submitLabel={m.staff_save_label()}
	successToast={m.staff_saved_toast()}
>
	{#snippet form()}
		<input {...edit.fields.projectId.as('hidden', projectId)} />
		<input {...edit.fields.workOrderId.as('hidden', task.id)} />
		<Field
			field={edit.fields.startsAt}
			type="datetime-local"
			label={m.staff_starts_label()}
			value={task.startsAt ? toLocalDateTime(task.startsAt) : ''}
		/>
		<Field
			field={edit.fields.endsAt}
			type="datetime-local"
			label={m.staff_ends_label()}
			value={task.endsAt ? toLocalDateTime(task.endsAt) : ''}
			description={m.staff_projects_id_reschedule_window_needs_both_ends_clear_body()}
		/>
		<Field
			field={edit.fields.dueAt}
			type="date"
			label={m.staff_due_label()}
			value={task.dueAt ? toLocalDate(task.dueAt) : ''}
			description={m.staff_projects_id_reschedule_deadline_not_window_done_by_body()}
		/>
	{/snippet}
</Action>
