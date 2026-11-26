<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ListingPosterCard from '#lib/components/events/ListingPosterCard.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { isOverdue } from '#lib/utils/work-order-due.js';
	import type { getStaffEventPage } from '#lib/remote/events.remote.js';
	import CrewBox from './CrewBox.svelte';

	/**
	 * The event page's sidebar, on every tab (#3270): the poster, then for a CMC
	 * show its crew and its open tasks.
	 */
	type Page = Awaited<ReturnType<typeof getStaffEventPage>>;
	let { data, onchange }: { data: Page; onchange: () => void } = $props();

	const evt = $derived(data.detail.event);
	const isShow = $derived(evt.source === 'cmc');
	const tasks = $derived(data.sidebar.tasks);
	// Pinned once, so "overdue" does not move while the page is open.
	const now = new Date();
</script>

<aside class="flex flex-col gap-4" aria-label={m.staff_events_id_sidebar_label()}>
	<ListingPosterCard
		eventId={evt.id}
		posterUrl={data.detail.posterUrl}
		posterSource={data.detail.posterSource}
		cancelled={evt.status === 'cancelled'}
		uploadWhileCancelled={data.canManage}
		{onchange}
	/>

	{#if isShow && data.sidebar.crew}
		<CrewBox
			eventId={evt.id}
			production={data.production}
			crew={data.sidebar.crew}
			lead={data.sidebar.lead}
			canAssignLead={data.sidebar.canAssignLead}
			hostOpen={data.sidebar.hostOpen}
			{onchange}
		/>
	{/if}

	{#if isShow && tasks}
		<InfoCard
			title={m.staff_events_id_open_tasks_title()}
			state={tasks.length}
			testid="event-tasks"
		>
			{#if tasks.length > 0}
				<ul class="flex flex-col divide-y divide-base-200 text-sm">
					{#each tasks as task (task.id)}
						<li class="flex items-baseline justify-between gap-2 py-2">
							<a class="min-w-0 link truncate link-hover" href={resolve(`staff/tasks/${task.id}`)}>
								{task.title ?? task.roleName}
							</a>
							{#if task.dueAt}
								<span class="shrink-0 {isOverdue(task, now) ? 'text-error' : 'text-muted'}">
									{formatDateShort(task.dueAt)}
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if data.sidebar.projectId}
				<div class="mt-2">
					<Button
						href={resolve('/staff/tasks/projects/[id]', { id: data.sidebar.projectId })}
						variant="ghost"
						size="sm"
					>
						{m.staff_events_id_view_project_label()}
					</Button>
				</div>
			{/if}
		</InfoCard>
	{/if}
</aside>
