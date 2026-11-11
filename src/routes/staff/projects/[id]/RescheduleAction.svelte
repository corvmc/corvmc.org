<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { rescheduleTaskForm } from '#lib/remote/tasks.remote.js';
	import { toLocalDate } from '#lib/utils/format.js';
	import type { Task } from './task-view';

	/**
	 * The task's deadline; blank clears it. A shift running past it is flagged,
	 * not refused. Shifts keep their own times (#2518).
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
			field={edit.fields.dueAt}
			type="date"
			label={m.staff_due_label()}
			value={task.dueAt ? toLocalDate(task.dueAt) : ''}
		/>
	{/snippet}
</Action>
