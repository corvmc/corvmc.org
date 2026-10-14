<script lang="ts">
	import {
		IconSquare,
		IconSquareCheck,
		IconSquareCheckFilled,
		IconSquareDot,
		IconSquareX
	} from '@tabler/icons-svelte';
	import { workDoneConditionLabels } from '$lib/config';
	import { checkState, type Task } from './task-view';

	let { task, size = 20 }: { task: Task; size?: number } = $props();

	const kind = $derived(checkState(task));
	const condition = $derived(task.doneWhen ? workDoneConditionLabels[task.doneWhen] : null);
	const label = $derived(
		{
			cancelled: 'Called off',
			ticked: task.doneWhen ? 'Done, ticked by hand' : 'Done',
			derived_done: `Done: ${condition}`,
			derived_open: `Open until: ${condition}`,
			overdue: 'Open, past its due date',
			open: 'Open'
		}[kind]
	);
</script>

<span class="inline-flex" title={label}>
	{#if kind === 'cancelled'}
		<IconSquareX {size} class="text-subtle" aria-label={label} />
	{:else if kind === 'ticked'}
		<IconSquareCheckFilled {size} class="text-success" aria-label={label} />
	{:else if kind === 'derived_done'}
		<IconSquareCheck {size} class="text-success" aria-label={label} />
	{:else if kind === 'derived_open'}
		<IconSquareDot {size} class="text-info" aria-label={label} />
	{:else}
		<IconSquare
			{size}
			class={kind === 'overdue' ? 'text-error' : 'text-subtle'}
			aria-label={label}
		/>
	{/if}
</span>
