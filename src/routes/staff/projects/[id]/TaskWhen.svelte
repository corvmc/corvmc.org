<script lang="ts">
	import { IconCalendar, IconFlag } from '@tabler/icons-svelte';
	import { formatDateShort } from '$lib/utils/format';
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
		aria-label="No date"
	>
		<IconCalendar size={14} stroke={1.5} />
	</span>
{:else}
	<span class="inline-flex items-center gap-1 {late ? 'text-error' : ''}">
		{when.kind === 'due' && task.dueAt ? formatDateShort(task.dueAt) : when.label}
		{#if late}<span class="sr-only">, overdue</span>{/if}
		{#if when.endsAfterDue}
			<IconFlag size={14} class="text-warning" aria-label="Ends after its due date" />
		{/if}
	</span>
{/if}
