<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { IconFlag, IconSquare, IconSquareCheck, IconX } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import {
		assetStatusLabels,
		requestableArtifactLabels,
		workDoneConditionLabels,
		type RequestableArtifact
	} from '$lib/config';
	import { formatCents, formatDateShort, formatDateShortYear } from '$lib/utils/format';
	import AssignedSummary from './AssignedSummary.svelte';
	import TaskCheck from './TaskCheck.svelte';
	import { whenOf, windowLabel, type Task, type TaskList } from './task-view';

	/** One task, beside the list: what the row shows, then the rest of it. */
	let {
		task,
		list,
		onclose,
		onopen
	}: {
		task: Task;
		list: TaskList;
		onclose: () => void;
		onopen: (id: string) => void;
	} = $props();

	const section = $derived(list.sections.find((s) => s.id === task.sectionId) ?? null);
	const when = $derived(whenOf(task));
	const engagement = $derived(task.mode === 'contractor' ? task.engagement : null);
	const titleOf = (id: string) => list.tasks.find((t) => t.id === id)?.title ?? 'A task';

	/** Unset properties, offered as additions. They come alive with editing. */
	const unset = $derived(
		[!task.startsAt && 'Scheduled', !task.dueAt && 'Due date', !task.assetId && 'Equipment'].filter(
			(x): x is string => !!x
		)
	);
</script>

<div class="flex items-start gap-2 border-b border-base-300 p-4">
	<span class="pt-1"><TaskCheck {task} /></span>
	<div class="min-w-0 flex-1">
		<h2 id="task-panel-title" class="text-lg font-semibold">{task.title}</h2>
		<p class="text-muted">
			{section?.name ?? 'No section'} ·
			<a class="link" href={resolve(`/staff/volunteer/shifts/${task.id}`)}>Details</a>
		</p>
	</div>
	<Button variant="ghost" size="sm" shape="square" aria-label="Close the task" onclick={onclose}>
		<IconX size={18} />
	</Button>
</div>

<div class="space-y-6 p-4">
	<DefinitionList>
		<Fact label="Assigned">
			<AssignedSummary {task} showNames />
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
			<Fact label="Scheduled">{windowLabel(task.startsAt, task.endsAt)}</Fact>
		{/if}
		{#if task.dueAt}
			<Fact label="Due">
				<span class="inline-flex items-center gap-1">
					{formatDateShortYear(task.dueAt)}
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
				{task.assetName ?? 'Equipment'}{task.assetTag ? ` · ${task.assetTag}` : ''}
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
			</Fact>
		{/if}
	</DefinitionList>

	{#if unset.length > 0}
		<p class="flex flex-wrap gap-x-3 gap-y-1 text-subtle" aria-label="Not set">
			{#each unset as u (u)}<span>+ {u}</span>{/each}
		</p>
	{/if}

	<section class="space-y-2" aria-label="Duties">
		<SectionLabel label="Duties" count={task.duties.total} />
		{#if task.dutyItems.length > 0}
			<ul class="space-y-1 text-sm">
				{#each task.dutyItems as d (d.id)}
					<li class="flex items-center gap-2 {d.done ? 'text-subtle line-through' : ''}">
						{#if d.done}
							<IconSquareCheck size={16} aria-label="Done" />
						{:else}
							<IconSquare size={16} aria-label="Not done" />
						{/if}
						{d.label}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-subtle">No duties.</p>
		{/if}
	</section>

	{#if task.notes}
		<section class="space-y-2" aria-label="Notes">
			<SectionLabel label="Notes" />
			<p class="text-sm whitespace-pre-wrap">{task.notes}</p>
		</section>
	{/if}
</div>

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
