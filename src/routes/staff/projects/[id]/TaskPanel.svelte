<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { IconFlag, IconX } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import {
		assetStatusLabels,
		requestableArtifactLabels,
		workDoneConditionLabels,
		type RequestableArtifact
	} from '#lib/config.js';
	import { formatCents, formatDateShort, formatDateShortYear } from '#lib/utils/format.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { cancelTaskForm, resolveTaskForm } from '#lib/remote/tasks.remote.js';
	import AssignPicker from './AssignPicker.svelte';
	import DutyItems from './DutyItems.svelte';
	import EquipmentAction from './EquipmentAction.svelte';
	import RescheduleAction from './RescheduleAction.svelte';
	import TaskCheckControl from './TaskCheckControl.svelte';
	import { whenOf, windowLabel, type Task, type TaskList } from './task-view';

	/** One task, beside the list: what the row shows, then the rest of it. */
	let {
		task,
		list,
		projectId,
		onclose,
		onopen
	}: {
		task: Task;
		list: TaskList;
		projectId: string;
		onclose: () => void;
		onopen: (id: string) => void;
	} = $props();

	const section = $derived(list.sections.find((s) => s.id === task.sectionId) ?? null);
	const when = $derived(whenOf(task));
	const engagement = $derived(task.mode === 'contractor' ? task.engagement : null);
	const titleOf = (id: string) => list.tasks.find((t) => t.id === id)?.title ?? 'A task';

	const live = $derived(!task.cancelledAt);
	const override = $derived(resolveTaskForm.for(`${task.id}:override`));
	const cancel = $derived(cancelTaskForm.for(task.id));
</script>

<div class="flex items-start gap-2 border-b border-base-300 p-4">
	<span class="pt-1"><TaskCheckControl {task} {projectId} place="panel" {onopen} /></span>
	<div class="min-w-0 flex-1">
		<h2 id="task-panel-title" class="text-lg font-semibold">{task.title}</h2>
		<p class="text-muted">
			{section?.name ?? m.staff_no_section_text()} ·
			<a class="link" href={resolve(`staff/projects/${projectId}/tasks/${task.id}`)}
				>{m.staff_details_text()}</a
			>
		</p>
	</div>
	<Button
		variant="ghost"
		size="sm"
		shape="square"
		aria-label={m.staff_projects_id_task_panel_close_task_label()}
		onclick={onclose}
	>
		<IconX size={18} />
	</Button>
</div>

<div class="space-y-6 p-4">
	<DefinitionList>
		<Fact label={m.staff_assigned_label()}>
			<AssignPicker {task} {projectId} place="panel" showNames />
			{#if task.roleName && task.mode !== 'contractor'}
				<span class="block text-muted">{task.roleName}</span>
			{/if}
		</Fact>
		{#if engagement && list.contractorMoney}
			{#if engagement.quotedCents !== null}
				<Fact label={m.staff_quoted_label()} value={formatCents(engagement.quotedCents)} />
			{/if}
			<Fact label={m.staff_cost_label()}>
				{#if engagement.costCents !== null}
					{formatCents(engagement.costCents)}
				{:else if engagement.isDonated}
					{engagement.fairValueCents !== null
						? m.staff_projects_id_task_panel_donated_worth_text({
								value: formatCents(engagement.fairValueCents)
							})
						: m.staff_projects_id_task_panel_donated_text()}
				{:else}
					<span class="text-muted">{m.staff_projects_id_task_panel_no_invoice_yet_text()}</span>
				{/if}
			</Fact>
			{#if engagement.invoiceRef}
				<Fact label={m.staff_projects_id_task_panel_invoice_label()}>
					{engagement.invoiceRef}{engagement.paidAt
						? m.staff_projects_id_task_panel_paid_text({
								formatDateShort: formatDateShort(engagement.paidAt)
							})
						: ''}
				</Fact>
			{/if}
		{/if}
		{#if task.startsAt && task.endsAt}
			<Fact label={m.staff_scheduled_label()}>
				{#if live}
					<RescheduleAction
						{task}
						{projectId}
						key="window"
						label={windowLabel(task.startsAt, task.endsAt)}
					/>
				{:else}
					{windowLabel(task.startsAt, task.endsAt)}
				{/if}
			</Fact>
		{/if}
		{#if task.dueAt}
			<Fact label={m.staff_due_label()}>
				<span class="inline-flex items-center gap-1">
					{#if live}
						<RescheduleAction
							{task}
							{projectId}
							key="due"
							label={formatDateShortYear(task.dueAt)}
						/>
					{:else}
						{formatDateShortYear(task.dueAt)}
					{/if}
					{#if when.endsAfterDue}
						<IconFlag size={14} class="text-warning" aria-hidden="true" />
						<span class="text-warning"
							>{m.staff_projects_id_task_panel_window_ends_after_text()}</span
						>
					{/if}
				</span>
			</Fact>
		{/if}
		<Fact label={m.staff_committee_label()}>
			{#if task.groupName}
				{task.groupName}
			{:else if list.committee}
				{list.committee.name}
				<span class="text-muted">{m.staff_projects_id_task_panel_from_project_text()}</span>
			{:else}
				<span class="text-muted">{m.staff_staff_text()}</span>
			{/if}
		</Fact>
		{#if task.assetId}
			<Fact label={m.staff_equipment_label()}>
				{#if live}
					<EquipmentAction
						{task}
						{projectId}
						label="{task.assetName ??
							m.staff_projects_id_task_panel_equipment_fallback_label()}{task.assetTag
							? ` · ${task.assetTag}`
							: ''}"
					/>
				{:else}
					{task.assetName ?? m.staff_equipment_text()}{task.assetTag ? ` · ${task.assetTag}` : ''}
				{/if}
				{#if task.assetStatus && task.assetStatus !== 'in_service'}
					<span class="block text-muted">{assetStatusLabels[task.assetStatus]}</span>
				{/if}
			</Fact>
		{/if}
		{#if task.dutyListName}
			<Fact label={m.staff_from_label()} value={task.dutyListName} />
		{/if}
		{#if task.doneWhen}
			<Fact label={m.staff_projects_id_task_panel_done_when_label()}>
				{workDoneConditionLabels[task.doneWhen]}
				{#if task.resolvedAt}
					<span class="block text-muted">
						{m.staff_projects_id_task_panel_ticked_by_hand_text({
							value: task.resolutionNotes ? `: ${task.resolutionNotes}` : ''
						})}
					</span>
				{:else if task.outstanding}
					{@render outstanding(task.outstanding)}
				{/if}
				{#if live && !task.resolvedAt}
					<Action
						action={override}
						label={m.staff_projects_id_task_panel_tick_by_hand_label()}
						variant="ghost"
						size="xs"
						class="mt-1"
						modalTitle={m.staff_projects_id_task_panel_tick_by_hand_2_title({ title: task.title })}
						submitLabel={m.staff_projects_id_task_panel_tick_label()}
						successToast={m.staff_projects_id_task_panel_ticked_toast()}
					>
						{#snippet form()}
							<input {...override.fields.projectId.as('hidden', projectId)} />
							<input {...override.fields.workOrderId.as('hidden', task.id)} />
							<p class="text-sm">
								{m.staff_projects_id_task_panel_ticks_itself_when_ticking_now_text({
									toLowerCase: workDoneConditionLabels[task.doneWhen!].toLowerCase()
								})}
							</p>
							<FormField
								field={override.fields.reason}
								type="textarea"
								label={m.staff_projects_id_task_panel_why_done_label()}
							/>
						{/snippet}
					</Action>
				{/if}
			</Fact>
		{/if}
	</DefinitionList>

	{#if live && (!task.startsAt || !task.dueAt || !task.assetId)}
		<div
			class="flex flex-wrap gap-1"
			aria-label={m.staff_projects_id_task_panel_add_property_label()}
		>
			{#if !task.startsAt}
				<RescheduleAction
					{task}
					{projectId}
					key="add-window"
					label={m.staff_projects_id_task_panel_scheduled_label()}
				/>
			{/if}
			{#if !task.dueAt}
				<RescheduleAction
					{task}
					{projectId}
					key="add-due"
					label={m.staff_projects_id_task_panel_due_date_label()}
				/>
			{/if}
			{#if !task.assetId}
				<EquipmentAction
					{task}
					{projectId}
					label={m.staff_projects_id_task_panel_equipment_label()}
				/>
			{/if}
		</div>
	{/if}

	<section class="space-y-2" aria-label={m.staff_projects_id_task_panel_duties_label()}>
		<SectionLabel label={m.staff_projects_id_task_panel_duties_label()} count={task.duties.total} />
		<DutyItems {task} {projectId} place="panel" />
	</section>

	{#if task.notes}
		<section class="space-y-2" aria-label={m.staff_notes_label()}>
			<SectionLabel label={m.staff_notes_label()} />
			<p class="text-sm whitespace-pre-wrap">{task.notes}</p>
		</section>
	{/if}
</div>

{#if live}
	<div class="border-t border-base-300 p-4">
		<Action
			action={cancel}
			label={m.staff_projects_id_task_panel_cancel_task_label()}
			variant="error"
			outline
			size="sm"
			modalTitle={m.staff_projects_id_task_panel_cancel_title({ title: task.title })}
			submitLabel={m.staff_projects_id_task_panel_cancel_task_label()}
			successToast={m.staff_projects_id_task_panel_task_called_off_toast()}
		>
			{#snippet form()}
				<input {...cancel.fields.projectId.as('hidden', projectId)} />
				<input {...cancel.fields.workOrderId.as('hidden', task.id)} />
				<p class="text-sm">
					{m.staff_projects_id_task_panel_calls_off_stays_list_struck_text()}
				</p>
			{/snippet}
		</Action>
	</div>
{/if}

{#snippet outstanding(o: NonNullable<Task['outstanding']>)}
	<div class="mt-1 space-y-1 text-muted">
		{#if o.kind === 'acts'}
			{#if o.notAsked.length > 0}
				<p>
					{m.staff_projects_id_task_panel_not_asked_yet_text({
						join: o.notAsked.map((a) => a.name).join(', ')
					})}
				</p>
			{/if}
			{#if o.awaiting.length > 0}
				<p>
					{m.staff_projects_id_task_panel_asked_not_arrived_text({
						join: o.awaiting
							.map(
								(r) =>
									`${r.actName ?? 'an act'} (${requestableArtifactLabels[r.artifact as RequestableArtifact] ?? r.artifact})`
							)
							.join(', ')
					})}
				</p>
			{/if}
			<a class="link" href="{resolve(`staff/events/${o.eventId}/production`)}?tab=advance">
				{m.staff_projects_id_task_panel_artifact_requests_text()}
			</a>
		{:else if o.kind === 'listing' || o.kind === 'production'}
			<a class="link" href={resolve(`staff/events/${o.eventId}/production`)}
				>{m.staff_projects_id_task_panel_open_show_text()}</a
			>
		{:else if o.kind === 'crew'}
			{#if o.taskIds.length > 0}
				<p>{m.staff_projects_id_task_panel_still_short_text()}</p>
				<ul>
					{#each o.taskIds as id (id)}
						<li>
							<Button variant="link" size="xs" onclick={() => onopen(id)}>{titleOf(id)}</Button>
						</li>
					{/each}
				</ul>
			{:else}
				<p>{m.staff_projects_id_task_panel_crew_tasks_list_full_others_text()}</p>
			{/if}
		{:else if o.kind === 'duties'}
			<p>{m.staff_projects_id_task_panel_its_duties_below_text()}</p>
		{:else}
			<p>{m.staff_projects_id_task_panel_task_no_show_so_its_text()}</p>
		{/if}
	</div>
{/snippet}
