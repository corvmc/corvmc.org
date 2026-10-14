<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { IconFlag, IconX } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import {
		assetStatusLabels,
		requestableArtifactLabels,
		workDoneConditionLabels,
		type RequestableArtifact
	} from '$lib/config';
	import { formatCents, formatDateShort, formatDateShortYear } from '$lib/utils/format';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { cancelTaskForm, resolveTaskForm } from '$lib/remote/tasks.remote';
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
			{section?.name ?? 'No section'} ·
			<a class="link" href={resolve(`/staff/projects/${projectId}/tasks/${task.id}`)}>Details</a>
		</p>
	</div>
	<Button variant="ghost" size="sm" shape="square" aria-label="Close the task" onclick={onclose}>
		<IconX size={18} />
	</Button>
</div>

<div class="space-y-6 p-4">
	<DefinitionList>
		<Fact label="Assigned">
			<AssignPicker {task} {projectId} place="panel" showNames />
			{#if task.roleName && task.mode !== 'contractor'}
				<span class="block text-muted">{task.roleName}</span>
			{/if}
		</Fact>
		{#if engagement}
			{#if engagement.quotedCents !== null}
				<Fact label="Quoted" value={formatCents(engagement.quotedCents)} />
			{/if}
			<Fact label="Cost">
				{#if engagement.costCents !== null}
					{formatCents(engagement.costCents)}
				{:else if engagement.isDonated}
					Donated{engagement.fairValueCents !== null
						? `, worth ${formatCents(engagement.fairValueCents)}`
						: ''}
				{:else}
					<span class="text-muted">No invoice yet</span>
				{/if}
			</Fact>
			{#if engagement.invoiceRef}
				<Fact label="Invoice">
					{engagement.invoiceRef}{engagement.paidAt
						? ` · paid ${formatDateShort(engagement.paidAt)}`
						: ''}
				</Fact>
			{/if}
		{/if}
		{#if task.startsAt && task.endsAt}
			<Fact label="Scheduled">
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
			<Fact label="Due">
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
						<span class="text-warning">the window ends after it</span>
					{/if}
				</span>
			</Fact>
		{/if}
		<Fact label="Committee">
			{#if task.groupName}
				{task.groupName}
			{:else if list.committee}
				{list.committee.name} <span class="text-muted">· from the project</span>
			{:else}
				<span class="text-muted">Staff</span>
			{/if}
		</Fact>
		{#if task.assetId}
			<Fact label="Equipment">
				{#if live}
					<EquipmentAction
						{task}
						{projectId}
						label="{task.assetName ?? 'Equipment'}{task.assetTag ? ` · ${task.assetTag}` : ''}"
					/>
				{:else}
					{task.assetName ?? 'Equipment'}{task.assetTag ? ` · ${task.assetTag}` : ''}
				{/if}
				{#if task.assetStatus && task.assetStatus !== 'in_service'}
					<span class="block text-muted">{assetStatusLabels[task.assetStatus]}</span>
				{/if}
			</Fact>
		{/if}
		{#if task.dutyListName}
			<Fact label="From" value={task.dutyListName} />
		{/if}
		{#if task.doneWhen}
			<Fact label="Done when">
				{workDoneConditionLabels[task.doneWhen]}
				{#if task.resolvedAt}
					<span class="block text-muted">
						Ticked by hand{task.resolutionNotes ? `: ${task.resolutionNotes}` : ''}
					</span>
				{:else if task.outstanding}
					{@render outstanding(task.outstanding)}
				{/if}
				{#if live && !task.resolvedAt}
					<Action
						action={override}
						label="Tick by hand"
						variant="ghost"
						size="xs"
						class="mt-1"
						modalTitle="Tick {task.title} by hand?"
						submitLabel="Tick it"
						successToast="Ticked"
					>
						{#snippet form()}
							<input {...override.fields.projectId.as('hidden', projectId)} />
							<input {...override.fields.workOrderId.as('hidden', task.id)} />
							<p class="text-sm">
								This ticks itself when {workDoneConditionLabels[task.doneWhen!].toLowerCase()}.
								Ticking it now marks it done regardless, and the reason is kept with it.
							</p>
							<FormField field={override.fields.reason} type="textarea" label="Why it is done" />
						{/snippet}
					</Action>
				{/if}
			</Fact>
		{/if}
	</DefinitionList>

	{#if live && (!task.startsAt || !task.dueAt || !task.assetId)}
		<div class="flex flex-wrap gap-1" aria-label="Add a property">
			{#if !task.startsAt}
				<RescheduleAction {task} {projectId} key="add-window" label="+ Scheduled" />
			{/if}
			{#if !task.dueAt}
				<RescheduleAction {task} {projectId} key="add-due" label="+ Due date" />
			{/if}
			{#if !task.assetId}
				<EquipmentAction {task} {projectId} label="+ Equipment" />
			{/if}
		</div>
	{/if}

	<section class="space-y-2" aria-label="Duties">
		<SectionLabel label="Duties" count={task.duties.total} />
		<DutyItems {task} {projectId} place="panel" />
	</section>

	{#if task.notes}
		<section class="space-y-2" aria-label="Notes">
			<SectionLabel label="Notes" />
			<p class="text-sm whitespace-pre-wrap">{task.notes}</p>
		</section>
	{/if}
</div>

{#if live}
	<div class="border-t border-base-300 p-4">
		<Action
			action={cancel}
			label="Cancel task"
			variant="error"
			outline
			size="sm"
			modalTitle="Cancel {task.title}?"
			submitLabel="Cancel task"
			successToast="Task called off"
		>
			{#snippet form()}
				<input {...cancel.fields.projectId.as('hidden', projectId)} />
				<input {...cancel.fields.workOrderId.as('hidden', task.id)} />
				<p class="text-sm">
					Calls it off. It stays on the list struck through, and anyone on it stays on the record to
					be told; nothing is deleted.
				</p>
			{/snippet}
		</Action>
	</div>
{/if}

{#snippet outstanding(o: NonNullable<Task['outstanding']>)}
	<div class="mt-1 space-y-1 text-muted">
		{#if o.kind === 'acts'}
			{#if o.notAsked.length > 0}
				<p>Not asked yet: {o.notAsked.map((a) => a.name).join(', ')}</p>
			{/if}
			{#if o.awaiting.length > 0}
				<p>
					Asked, not arrived:
					{o.awaiting
						.map(
							(r) =>
								`${r.actName ?? 'an act'} (${requestableArtifactLabels[r.artifact as RequestableArtifact] ?? r.artifact})`
						)
						.join(', ')}
				</p>
			{/if}
			<a class="link" href="{resolve(`/staff/events/${o.eventId}/production`)}?tab=advance">
				Artifact requests
			</a>
		{:else if o.kind === 'listing' || o.kind === 'production'}
			<a class="link" href={resolve(`/staff/events/${o.eventId}/production`)}>Open the show</a>
		{:else if o.kind === 'crew'}
			{#if o.taskIds.length > 0}
				<p>Still short:</p>
				<ul>
					{#each o.taskIds as id (id)}
						<li>
							<Button variant="link" size="xs" onclick={() => onopen(id)}>{titleOf(id)}</Button>
						</li>
					{/each}
				</ul>
			{:else}
				<p>The crew tasks on this list are full; others on the show may not be.</p>
			{/if}
		{:else if o.kind === 'duties'}
			<p>Its duties, below.</p>
		{:else}
			<p>This task is on no show, so its condition cannot hold. Tick it by hand.</p>
		{/if}
	</div>
{/snippet}
