<script lang="ts">
	import {
		IconCircleCheck,
		IconCircleCheckFilled,
		IconCircleDot,
		IconCircleX
	} from '@tabler/icons-svelte';
	import { workDoneConditionLabels } from '$lib/config';
	import { checkState, type Task } from './task-view';

	/** A thin ring with a check, filled once done. App-ticked states draw in info, not success. */
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

<span class="inline-flex" title={label} data-check-state={kind}>
	{#if kind === 'cancelled'}
		<IconCircleX {size} stroke={1.5} class="text-subtle" aria-label={label} />
	{:else if kind === 'ticked'}
		<IconCircleCheckFilled {size} class="text-success" aria-label={label} />
	{:else if kind === 'derived_done'}
		<IconCircleCheckFilled {size} class="text-info" aria-label={label} />
	{:else if kind === 'derived_open'}
		<IconCircleDot {size} stroke={1.5} class="text-info" aria-label={label} />
	{:else}
		<IconCircleCheck
			{size}
			stroke={1.5}
			class={kind === 'overdue' ? 'text-error' : 'text-subtle'}
			aria-label={label}
		/>
	{/if}
</span>
