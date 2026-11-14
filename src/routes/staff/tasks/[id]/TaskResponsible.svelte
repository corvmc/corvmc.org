<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Who a task waits on, and why the viewer can or cannot act on it (#2994).
	 * Both read from the rule the remotes enforce: `waitingOn` and `canActOnTask`.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import TaskActReason from '#lib/components/task/TaskActReason.svelte';
	import { capabilityLabel } from '#lib/capability-label.js';
	import { getTaskWhy } from '#lib/remote/volunteer.remote.js';

	let { workOrderId }: { workOrderId: string } = $props();

	const why = $derived(await getTaskWhy(workOrderId));
</script>

<InfoCard
	title={m.staff_tasks_id_responsible_title()}
	state={why.waitsOn.length}
	testid="task-responsible"
>
	{#if why.waitsOn.length === 0}
		<EmptyState
			title={m.staff_tasks_id_responsible_none_title()}
			description={m.staff_tasks_id_responsible_none_body({
				grant: capabilityLabel(why.viewer.grant)
			})}
		/>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each why.waitsOn as w (w.userId)}
				<li class="flex flex-wrap items-center justify-between gap-2" data-reason={w.reason}>
					<span>{w.name}</span>
					<Badge size="sm" variant="ghost">
						{w.reason === 'assignee'
							? m.staff_tasks_id_responsible_assigned_label()
							: w.reason === 'position'
								? m.staff_tasks_id_responsible_holds_label({
										position: why.viewer.position?.name ?? ''
									})
								: m.staff_tasks_id_responsible_seat_label({
										committee: why.viewer.committee?.name ?? ''
									})}
					</Badge>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>

<InfoCard title={m.staff_tasks_id_your_access_title()}>
	<TaskActReason why={why.viewer} />
</InfoCard>
