<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/**
	 * One task: who is assigned, each of its shifts with its own roster, who to
	 * ask, its engagements, hours, reports and checklist (#2518). Rendered by the
	 * shift URL and by a project's task page, which passes its project as
	 * `context`. Done and Cancel for the work are the task's; each shift card
	 * cancels only itself.
	 */
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { shiftLabel } from '#lib/utils/shift-label.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { Crumb } from '#lib/components/ui/breadcrumbs.js';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import ShiftRoleFields from './ShiftRoleFields.svelte';
	import ShiftChecklist from './ShiftChecklist.svelte';
	import ShiftCard from './ShiftCard.svelte';
	import OpenShiftAction from './OpenShiftAction.svelte';
	import CandidateColumn from './CandidateColumn.svelte';
	import WorkOrderHours from './WorkOrderHours.svelte';
	import WorkOrderReports from './WorkOrderReports.svelte';
	import EngagementCard from '#lib/components/contractor/EngagementCard.svelte';
	import { formatDateShort, formatDateShortYear } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import { IconPencil, IconUserMinus } from '@tabler/icons-svelte';
	import {
		cancelTask,
		resolveWorkOrder,
		unassignFromTask,
		updateTask,
		type getStaffShiftPage
	} from '#lib/remote/volunteer.remote.js';

	type View = Omit<Awaited<ReturnType<typeof getStaffShiftPage>>, 'contractors'>;
	let {
		view,
		subtitle,
		parent,
		context,
		activity,
		actions
	}: {
		view: View;
		subtitle: string;
		/** Crumbs the URL cannot supply: the project above a task. */
		parent?: Crumb[];
		/** Leads the line under the header: the project a task belongs to. */
		context?: Snippet;
		/** The task's history, read by each page through its own guard. */
		activity?: Snippet;
		/** Header actions a page adds to the view's own. */
		actions?: Snippet;
	} = $props();

	const task = $derived(view.task);
	const label = $derived(shiftLabel(task));
	const open = $derived(!task.cancelledAt && !task.resolvedAt);
	const editForm = $derived(updateTask.for(task.id));
	const liveShifts = $derived(
		view.shifts.filter((s) => !s.cancelledAt && s.endsAt.getTime() > Date.now())
	);

	// Who "Who to ask" adds people to: a shift still to come, or the task itself.
	// Seeded with the next shift and kept by id, so a refresh does not reset it.
	let target = $state<string>(untrack(() => liveShifts[0]?.id ?? ''));
	const targetShift = $derived(liveShifts.find((s) => s.id === target) ?? null);
</script>

<PageHeader title={label} {subtitle} {parent}>
	{@render actions?.()}
	{#if open}
		<OpenShiftAction
			taskId={task.id}
			{label}
			start={task.dueAt}
			capacity={task.pendingCapacity ?? 1}
			size="sm"
		/>
		<Action
			action={resolveWorkOrder.for(task.id)}
			label={m.staff_volunteer_mark_done_label()}
			data-testid="mark-done"
			variant="ghost"
			size="sm"
			modalTitle={m.staff_volunteer_mark_done_title({ subject: label })}
			submitLabel={m.staff_volunteer_mark_done_label()}
			successToast={m.staff_volunteer_marked_done_toast()}
		>
			{#snippet form()}
				<input {...resolveWorkOrder.for(task.id).fields.id.as('hidden', task.id)} />
				{#if view.reports.length > 0}
					<p class="text-sm">
						{m.staff_volunteer_mark_done_closes_reports_text({ reports: view.reports.length })}
					</p>
				{/if}
				<FormField
					field={resolveWorkOrder.for(task.id).fields.notes}
					label={m.staff_volunteer_work_done_label()}
					type="textarea"
				/>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	<!-- Time and event lead the body rather than the header: PageHeader's
	     subtitle is the panel label everywhere else in the app. -->
	<p class="text-subtle text-sm">
		{#if context}{@render context()} ·{/if}
		{#if task.dueAt}
			{@const due = task.dueAt}
			<!-- A deadline is not a shift: "done by Friday" is not "happens Friday 6-8". -->
			<ParaglideMessage
				message={m.volunteer_work_order_view_due_text}
				inputs={{ formatDateShortYear: formatDateShortYear(due) }}
				>{#snippet time({ children })}<time datetime={new Date(due).toISOString()}
						>{@render children?.()}</time
					>{/snippet}</ParaglideMessage
			> ·
		{/if}
		{#if task.eventId && task.eventTitle}
			<a href={resolve(`staff/events/${task.eventId}`)} class="link link-primary">
				{task.eventTitle}
			</a>
		{:else}{m.volunteer_work_order_view_not_tied_event_text()}{/if}
		{#if task.assetId && task.assetName}
			·
			<a href={resolve(`staff/inventory/assets/${task.assetId}`)} class="link link-primary">
				{task.assetName}
			</a>
		{/if}
	</p>

	{#if task.cancelledAt}
		<Alert type="warning">
			{task.cancelledByName
				? m.volunteer_work_order_view_task_called_off_by_text({
						date: formatDateShort(task.cancelledAt),
						name: task.cancelledByName
					})
				: m.volunteer_work_order_view_task_called_off_text({
						date: formatDateShort(task.cancelledAt)
					})}
		</Alert>
	{:else if task.resolvedAt}
		<Alert type="success">
			{m.volunteer_work_order_view_task_done_text({ date: formatDateShort(task.resolvedAt) })}
		</Alert>
	{/if}

	<!-- Ahead of the roster: on a contractor's task the engagement is the work. -->
	{#if view.engagements.length > 0}
		<section class="flex flex-col gap-3" aria-labelledby="engagements-heading">
			<h2 id="engagements-heading" class="text-lg font-semibold">
				{m.volunteer_work_order_view_engagements_title()}
			</h2>
			{#each view.engagements as row (row.job.id)}
				<EngagementCard {row} />
			{/each}
		</section>
	{/if}

	<div class="grid gap-6 {open ? 'lg:grid-cols-2' : ''}">
		<div class="flex flex-col gap-6">
			{#if view.assignees.length > 0}
				<InfoCard
					title={m.volunteer_work_order_view_assignees_title()}
					state={view.assignees.length}
					testid="assignees"
				>
					<ul class="flex flex-col gap-2">
						{#each view.assignees as a (a.userId)}
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

			<section class="flex flex-col gap-3" aria-labelledby="shifts-heading">
				<h2 id="shifts-heading" class="text-lg font-semibold">
					{m.volunteer_work_order_view_shifts_title()}
					<span class="text-muted font-normal">· {view.shifts.length}</span>
				</h2>
				{#if view.shifts.length === 0}
					<EmptyState
						title={m.volunteer_work_order_view_no_shifts_title()}
						description={view.engagements.length > 0
							? m.volunteer_work_order_view_contractor_answers_one_see_engagem_body()
							: undefined}
					/>
				{/if}
				{#each view.shifts as shift (shift.id)}
					<ShiftCard {shift} taskOpen={open} />
				{/each}
			</section>

			{#if view.tasks.length > 0}
				<ShiftChecklist tasks={view.tasks} shiftId={task.id} />
			{/if}

			<InfoCard title={m.volunteer_work_order_view_task_notes_title()}>
				{#if task.notes}
					<p class="text-sm">{task.notes}</p>
				{:else}
					<p class="text-subtle text-sm">{m.volunteer_work_order_view_no_notes_text()}</p>
				{/if}

				{#if open}
					<div class="mt-4 flex flex-wrap gap-2">
						<Action
							action={editForm}
							label={m.volunteer_work_order_view_edit_label()}
							data-testid="edit-task"
							variant="ghost"
							size="sm"
							modalTitle={m.volunteer_work_order_view_edit_task_title()}
							submitLabel={m.volunteer_save_label()}
							successToast={m.volunteer_work_order_view_task_updated_toast()}
						>
							{#snippet icon()}<IconPencil size={16} />{/snippet}
							{#snippet form()}
								<input {...editForm.fields.id.as('hidden', task.id)} />
								<!-- An archived role stays in the list when this task is on it, or
								     the select would post an empty role and quietly reassign it. -->
								<ShiftRoleFields
									form={editForm}
									taskOnly
									keepId={task.volunteerRoleId}
									roleId={task.volunteerRoleId ?? undefined}
									initialEvent={task.eventId && task.eventTitle
										? { id: task.eventId, title: task.eventTitle }
										: null}
									initialAsset={task.assetId && task.assetName
										? { id: task.assetId, name: task.assetName }
										: null}
									startsAt=""
									endsAt=""
									capacity=""
									notes={task.notes ?? ''}
									title={task.title ?? ''}
								/>
							{/snippet}
						</Action>

						<Action
							action={cancelTask.for(task.id)}
							label={m.volunteer_work_order_view_cancel_task_label()}
							data-testid="cancel-task"
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle={m.volunteer_work_order_view_cancel_task_title()}
							submitLabel={m.volunteer_work_order_view_cancel_task_label()}
							submitVariant="error"
							successToast={m.volunteer_work_order_view_called_off_tell_people_toast()}
						>
							{#snippet form()}
								<input {...cancelTask.for(task.id).fields.id.as('hidden', task.id)} />
								<p class="text-sm">{m.volunteer_work_order_view_cancel_task_body()}</p>
							{/snippet}
						</Action>
					</div>
				{/if}
			</InfoCard>
		</div>

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
	</div>

	{#if view.hours.length > 0}
		<WorkOrderHours hours={view.hours} shiftId={task.id} />
	{/if}

	{#if view.reports.length > 0}
		<WorkOrderReports reports={view.reports} />
	{/if}

	{#if view.feedback.length > 0}
		<InfoCard title={m.volunteer_work_order_view_how_went_title()}>
			<ul class="flex flex-col gap-3">
				{#each view.feedback as response (response.signupId)}
					<li class="text-sm">
						<div class="flex items-center gap-2">
							<span
								class="text-warning"
								aria-label={m.volunteer_work_order_view_aria_label({ rating: response.rating })}
							>
								{'★'.repeat(response.rating)}{'☆'.repeat(5 - response.rating)}
							</span>
							{#if !response.wasSetUp}
								<!-- The actionable signal: enjoyment and preparedness pull
								     apart exactly where the briefing needs work. -->
								<Badge variant="warning">{m.volunteer_work_order_view_wasn_t_set_up_label()}</Badge>
							{/if}
						</div>
						{#if response.comment}
							<p class="mt-1 opacity-80">{response.comment}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</InfoCard>
	{/if}

	{@render activity?.()}
</PageContent>

{#snippet unassignIcon()}
	<IconUserMinus size={16} />
{/snippet}
