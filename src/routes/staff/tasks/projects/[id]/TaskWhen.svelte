<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconCalendar, IconFlag } from '@tabler/icons-svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { isOverdue, whenOf, type Task } from './task-view';

	/** The row's When: plain date text, red once past; a dashed calendar circle when unset. */
	let { task }: { task: Task } = $props();

	const when = $derived(whenOf(task));
	const late = $derived(isOverdue(task));
</script>

{#if when.kind === 'none'}
	<span
		class="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-base-content/40 text-subtle"
		role="img"
		aria-label={m.staff_projects_id_task_when_no_date_label()}
	>
		<IconCalendar size={14} stroke={1.5} />
	</span>
{:else}
	<span class="inline-flex items-center gap-1 {late ? 'text-error' : ''}">
		{when.kind === 'due' && task.dueAt ? formatDateShort(task.dueAt) : when.label}
		{#if task.shifts.length > 1}
			<!-- The latest shift's time leads; the rest are on the task. -->
			<span class="text-muted"
				>{m.staff_projects_id_task_when_more_shifts_text({ more: task.shifts.length - 1 })}</span
			>
		{/if}
		{#if late}<span class="sr-only">{m.staff_projects_id_task_when_overdue_text()}</span>{/if}
		{#if when.endsAfterDue}
			<IconFlag
				size={14}
				class="text-warning"
				aria-label={m.staff_projects_id_task_when_ends_after_its_due_date_label()}
			/>
		{/if}
	</span>
{/if}
