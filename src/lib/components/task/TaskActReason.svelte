<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Why the viewer can or cannot act on a task (#2994), from `canActOnTask`'s
	 * reason. A refusal lists each route the rule checked and found closed.
	 */
	import { capabilityLabel } from '#lib/capability-label.js';
	import type { getTaskWhy } from '#lib/remote/volunteer.remote.js';

	let { why }: { why: Awaited<ReturnType<typeof getTaskWhy>>['viewer'] } = $props();

	const grant = $derived(capabilityLabel(why.grant));
</script>

<div class="text-sm" data-testid="task-act-reason" data-reason={why.reason ?? 'none'}>
	{#if why.reason === 'assignee'}
		<p>{m.task_act_reason_assignee_text()}</p>
	{:else if why.reason === 'position'}
		<p>{m.task_act_reason_position_text({ position: why.position?.name ?? '' })}</p>
	{:else if why.reason === 'department'}
		<p>{m.task_act_reason_department_text({ committee: why.committee?.name ?? '' })}</p>
	{:else if why.reason === 'grant'}
		<p>{m.task_act_reason_grant_text({ grant })}</p>
	{:else}
		<p>{m.task_act_reason_none_text()}</p>
		<ul class="mt-1 list-disc pl-5 text-muted">
			<li>{m.task_act_reason_not_assigned_text()}</li>
			{#if why.position}
				<li>{m.task_act_reason_no_position_text({ position: why.position.name })}</li>
			{/if}
			{#if why.committee}
				<li>{m.task_act_reason_no_seat_text({ committee: why.committee.name })}</li>
			{/if}
			<li>{m.task_act_reason_no_grant_text({ grant })}</li>
		</ul>
	{/if}
</div>
