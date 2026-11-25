<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Who is on a task and who to ask (#3270): its assignees, each with
	 * Unassign, above the "Who to ask" shortlist. The task page and the event
	 * page's Crew box both staff a task through this one component.
	 */
	import { untrack } from 'svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import CandidateColumn from './CandidateColumn.svelte';
	import { IconUserMinus } from '@tabler/icons-svelte';
	import { unassignFromTask, type getTaskPage } from '#lib/remote/volunteer.remote.js';

	type View = Awaited<ReturnType<typeof getTaskPage>>;
	let {
		task,
		assignees,
		shifts,
		target = $bindable(untrack(() => firstLive(shifts)))
	}: {
		task: Pick<View['task'], 'id' | 'roleName' | 'cancelledAt' | 'resolvedAt'>;
		assignees: View['assignees'];
		shifts: Pick<View['shifts'][number], 'id' | 'startsAt' | 'endsAt' | 'cancelledAt'>[];
		/** The shift "Who to ask" adds people to, or `''` for the task itself. */
		target?: string;
	} = $props();

	function live(list: typeof shifts) {
		return list.filter((s) => !s.cancelledAt && s.endsAt.getTime() > Date.now());
	}
	function firstLive(list: typeof shifts) {
		return live(list)[0]?.id ?? '';
	}

	const open = $derived(!task.cancelledAt && !task.resolvedAt);
	const liveShifts = $derived(live(shifts));
	const targetShift = $derived(liveShifts.find((s) => s.id === target) ?? null);
</script>

{#if assignees.length > 0}
	<InfoCard
		title={m.volunteer_work_order_view_assignees_title()}
		state={assignees.length}
		testid="assignees"
	>
		<ul class="flex flex-col gap-2">
			{#each assignees as a (a.userId)}
				{@const drop = unassignFromTask.for(`${task.id}:${a.userId}`)}
				<li class="flex flex-wrap items-center justify-between gap-2">
					<EntityIdentity ref={a.member} />
					{#if open && !a.completedAt}
						<Action
							action={drop}
							label={m.volunteer_work_order_view_unassign_label()}
							iconOnly
							icon={unassignIcon}
							variant="ghost"
							size="sm"
							modalTitle={m.volunteer_work_order_view_unassign_title({
								title: a.member.title
							})}
							submitLabel={m.volunteer_work_order_view_unassign_label()}
							successToast={m.volunteer_work_order_view_unassigned_toast()}
						>
							{#snippet form()}
								<input {...drop.fields.workOrderId.as('hidden', task.id)} />
								<input {...drop.fields.userId.as('hidden', a.userId)} />
							{/snippet}
						</Action>
					{/if}
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}

<!-- Nobody can be put on work with no role, so there is nobody to suggest. -->
{#if open && task.roleName !== null}
	<CandidateColumn
		workOrderId={task.id}
		shifts={liveShifts}
		bind:target
		shiftId={targetShift?.id ?? null}
		startsAt={targetShift?.startsAt ?? null}
	/>
{/if}

{#snippet unassignIcon()}
	<IconUserMinus size={16} />
{/snippet}
