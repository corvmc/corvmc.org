<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The member's volunteering dashboard: a next-action stack beside a board.
	 *
	 * The left column is only what is owed or pending: hours to log, tasks
	 * assigned to them, and shifts they signed up for. Contact info, roles and
	 * hour history live on the profile.
	 *
	 * The gate is still the gate: inside the wrapper `getMyVolunteerAccess` is
	 * awaited first, so its server-side redirect — an un-onboarded member to
	 * /start, a blocked one to /blocked — happens ahead of the rest rather than
	 * racing it. The page needs no client-side check of its own.
	 */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import OpenShifts from '#lib/components/volunteer/OpenShifts.svelte';
	import ShiftInvitations from '#lib/components/volunteer/ShiftInvitations.svelte';
	import MyShiftCard from '#lib/components/volunteer/MyShiftCard.svelte';
	import LogHoursAction from '#lib/components/volunteer/LogHoursAction.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { shiftLabel } from '#lib/utils/shift-label.js';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import { getMemberVolunteerPage, markMyTaskDone } from '#lib/remote/volunteer.remote.js';

	const pageData = $derived(await getMemberVolunteerPage());

	function toDateInput(date: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(new Date(date));
	}

	/** Shift duration → the hours input, rounded to the quarter-hour step. */
	function shiftHours(startsAt: Date, endsAt: Date): string {
		const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
		return String(Math.round(hours * 4) / 4);
	}

	// Everything they are on that has not been worked yet, plus anything worked
	// that still owes hours or feedback. A shift from March is history.
	const liveShifts = $derived(
		pageData.myShifts.filter(
			(s) => s.status !== 'completed' || s.endsAt > new Date(Date.now() - 14 * 86_400_000)
		)
	);

	const owed = $derived(pageData.unloggedShifts.length + pageData.unloggedTasks.length);
</script>

<PageHeader width="5xl" title={m.member_volunteering_title()} subtitle={m.member_member_body()}>
	<Button href={resolve('member/volunteer/profile')} variant="ghost" size="sm"
		>{m.member_profile_label()}</Button
	>
</PageHeader>

<PageContent width="5xl">
	<div class="grid items-start gap-6 lg:grid-cols-2">
		<div class="flex flex-col gap-6">
			{#if owed > 0}
				<!--
					The only accented card on the page, because it is the only one that
					is genuinely owed: they did the work, and the record does not exist
					until they say what it was.
				-->
				<InfoCard
					title={m.member_volunteer_hours_log_title()}
					state={owed}
					class="border-l-4 border-warning"
					testid="unlogged-work"
				>
					<!-- Once, not on every row: it was the same sentence under each. -->
					<p class="text-subtle text-sm">{m.member_volunteer_add_what_did_file_text()}</p>
					<ul class="flex flex-col gap-3">
						{#each pageData.unloggedShifts as owed (owed.signupId)}
							<li class="flex flex-wrap items-center justify-between gap-2">
								<div class="min-w-0">
									<div class="font-medium">{owed.roleName}</div>
									<div class="text-subtle text-sm">
										{m.member_volunteer_hrs_text({
											formatDateShort: formatDateShort(owed.startsAt),
											shiftHours: shiftHours(owed.startsAt, owed.endsAt)
										})}
									</div>
								</div>
								<LogHoursAction
									mode="shift"
									variant="primary"
									label={m.member_volunteer_label()}
									shift={{
										signupId: owed.signupId,
										shiftId: owed.shiftId,
										volunteerRoleId: owed.volunteerRoleId,
										roleName: owed.roleName,
										startsAt: owed.startsAt,
										hours: shiftHours(owed.startsAt, owed.endsAt),
										workedOn: toDateInput(owed.startsAt)
									}}
								/>
							</li>
						{/each}
						<!-- A task has no time to prefill from; marking it done is the prompt. -->
						{#each pageData.unloggedTasks as task (task.workOrderId)}
							<li
								class="flex flex-wrap items-center justify-between gap-2"
								data-work-order-id={task.workOrderId}
							>
								<div class="min-w-0">
									<div class="font-medium">{shiftLabel(task)}</div>
									<div class="text-subtle text-sm">
										{m.member_volunteer_unlogged_task_done_text({
											formatDateShort: formatDateShort(task.completedAt ?? task.resolvedAt!)
										})}
									</div>
								</div>
								<LogHoursAction
									mode="task"
									variant="primary"
									label={m.member_volunteer_label()}
									roles={pageData.roles}
									task={{
										workOrderId: task.workOrderId,
										volunteerRoleId: task.volunteerRoleId,
										workedOn: toDateInput(task.completedAt ?? task.resolvedAt!)
									}}
								/>
							</li>
						{/each}
					</ul>
				</InfoCard>
			{/if}

			{#if pageData.assignedTasks.length > 0}
				<InfoCard
					title={m.member_volunteer_assigned_tasks_title()}
					state={pageData.assignedTasks.length}
					testid="assigned-tasks"
				>
					<ul class="divide-y divide-base-300">
						{#each pageData.assignedTasks as task (task.workOrderId)}
							<li
								class="flex flex-wrap items-center justify-between gap-2 py-3"
								data-work-order-id={task.workOrderId}
							>
								<div class="min-w-0">
									<div class="font-medium">{shiftLabel(task)}</div>
									<div class="text-subtle text-sm">
										{#if task.dueAt}
											{m.member_volunteer_assigned_tasks_due_text({
												formatDateShort: formatDateShort(task.dueAt)
											})}
										{/if}
										{#if task.checklist.total > 0}
											{#if task.dueAt}·{/if}
											{m.member_volunteer_assigned_tasks_checklist_text({
												done: task.checklist.done,
												total: task.checklist.total
											})}
										{/if}
									</div>
								</div>
								<!-- A task with a done condition closes itself when it holds. -->
								{#if !task.closesItself}
									<Action
										action={markMyTaskDone.for(task.workOrderId)}
										label={m.member_volunteer_assigned_tasks_mark_done_label()}
										variant="ghost"
										size="xs"
										modalTitle={m.member_volunteer_assigned_tasks_mark_done_title()}
										submitLabel={m.member_volunteer_assigned_tasks_mark_done_label()}
										successToast={m.member_volunteer_assigned_tasks_marked_done_toast()}
									>
										{#snippet form()}
											<input
												{...markMyTaskDone
													.for(task.workOrderId)
													.fields.workOrderId.as('hidden', task.workOrderId)}
											/>
											<p class="text-sm">{m.member_volunteer_assigned_tasks_mark_done_body()}</p>
										{/snippet}
									</Action>
								{/if}
							</li>
						{/each}
					</ul>
				</InfoCard>
			{/if}

			<InfoCard
				title={m.member_volunteer_claimed_shifts_title()}
				state={liveShifts.length}
				testid="my-shifts"
			>
				{#if liveShifts.length === 0}
					<EmptyState
						title={m.member_volunteer_re_not_any_shifts_title()}
						description={m.member_volunteer_description_body()}
					/>
				{:else}
					<ul class="divide-y divide-base-300">
						{#each liveShifts as shift (shift.signupId)}
							<li><MyShiftCard {shift} /></li>
						{/each}
					</ul>
				{/if}
			</InfoCard>
		</div>

		<!-- Its own column, like the left one. As two bare grid items these landed
		     in different rows, so the board started at the bottom of whatever the
		     left column's height happened to be. -->
		<div class="flex flex-col gap-6">
			<!-- Above the board: an invitation is addressed to this member, where
			     the board is addressed to everybody. -->
			<ShiftInvitations invitations={pageData.invitations} />

			<OpenShifts shifts={pageData.openShifts} hasInterests={pageData.interests.length > 0} />
		</div>
	</div>
</PageContent>
