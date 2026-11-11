<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { resolveTaskForm, reopenTaskForm } from '#lib/remote/tasks.remote.js';
	import TaskCheck from './TaskCheck.svelte';
	import type { Task } from './task-view';

	/**
	 * The checkbox that ticks. A task with a done condition is the app's to tick:
	 * until somebody overrides it by hand, clicking opens what it is waiting on
	 * rather than toggling. Ticked by hand, it unticks back to its condition.
	 */
	let {
		task,
		projectId,
		place,
		onopen
	}: {
		task: Task;
		projectId: string;
		/** A form instance binds to one `<form>`; the row and the panel each need their own. */
		place: 'row' | 'panel';
		onopen: (id: string) => void;
	} = $props();

	const tick = $derived(resolveTaskForm.for(`${place}:${task.id}`));
	const untick = $derived(reopenTaskForm.for(`${place}:${task.id}`));
</script>

{#if task.cancelledAt}
	<TaskCheck {task} />
{:else if task.doneWhen && !task.resolvedAt}
	<Button
		variant="ghost"
		size="xs"
		shape="square"
		class="depth-0"
		aria-label={m.staff_projects_id_task_check_control_what_waiting_label({ title: task.title })}
		onclick={() => onopen(task.id)}
	>
		<TaskCheck {task} />
	</Button>
{:else if task.resolvedAt}
	<Form remote={untick}>
		<input {...untick.fields.projectId.as('hidden', projectId)} />
		<input {...untick.fields.workOrderId.as('hidden', task.id)} />
		<Button
			type="submit"
			variant="ghost"
			size="xs"
			shape="square"
			class="depth-0 bare"
			aria-label={m.staff_projects_id_task_check_control_mark_not_done_label({ title: task.title })}
		>
			<TaskCheck {task} />
		</Button>
	</Form>
{:else}
	<Form remote={tick}>
		<input {...tick.fields.projectId.as('hidden', projectId)} />
		<input {...tick.fields.workOrderId.as('hidden', task.id)} />
		<Button
			type="submit"
			variant="ghost"
			size="xs"
			shape="square"
			class="depth-0 bare"
			aria-label={m.staff_projects_id_task_check_control_mark_done_label({ title: task.title })}
		>
			<TaskCheck {task} />
		</Button>
	</Form>
{/if}
