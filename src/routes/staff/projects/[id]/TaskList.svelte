<script lang="ts">
	import Table from '$lib/components/ui/Table.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		IconChevronDown,
		IconChevronRight,
		IconFlag,
		IconGripVertical
	} from '@tabler/icons-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import {
		createSectionForm,
		moveTaskCommand,
		reorderSectionsCommand
	} from '$lib/remote/tasks.remote';
	import AddTaskLine from './AddTaskLine.svelte';
	import AssignPicker from './AssignPicker.svelte';
	import DutyItems from './DutyItems.svelte';
	import SectionMenu from './SectionMenu.svelte';
	import TaskCheckControl from './TaskCheckControl.svelte';
	import { dropSection, dropSlot, stepSection, stepTask, type TaskSlot } from './task-order';
	import {
		TASK_FILTERS,
		TASK_FILTER_LABELS,
		costOf,
		groupBySection,
		isDone,
		matchesFilter,
		whenOf,
		type TaskFilter,
		type TaskList
	} from './task-view';

	let {
		list,
		viewerId,
		selectedId,
		filter,
		showDone,
		projectId,
		onopen,
		onfilter,
		onshowdone
	}: {
		list: TaskList;
		viewerId: string;
		selectedId: string | null;
		filter: TaskFilter;
		showDone: boolean;
		projectId: string;
		onopen: (id: string) => void;
		onfilter: (f: TaskFilter) => void;
		onshowdone: (show: boolean) => void;
	} = $props();

	const groups = $derived(
		groupBySection(
			list.sections,
			list.tasks,
			(t) => matchesFilter(t, filter, viewerId) && (showDone || !isDone(t))
		)
	);
	const hiddenDone = $derived(
		showDone ? 0 : list.tasks.filter((t) => isDone(t) && matchesFilter(t, filter, viewerId)).length
	);

	/** Rows whose duties are unfolded. Local: it is a view of the row, not a fact. */
	const unfolded = new SvelteSet<string>();
	function toggleDuties(id: string) {
		if (unfolded.has(id)) unfolded.delete(id);
		else unfolded.add(id);
	}

	function open(event: MouseEvent, id: string) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();
		onopen(id);
	}

	function rowClick(event: MouseEvent, id: string) {
		const target = event.target as HTMLElement;
		if (target.closest('a,button,input,label,form,details,[data-no-row-click]')) return;
		if (window.getSelection()?.toString()) return;
		onopen(id);
	}

	const sectionIds = $derived(list.sections.map((s) => s.id));
	const addSection = createSectionForm;

	// Reordering: drag a handle, or focus it and press the arrow keys.
	type Drag = { kind: 'task' | 'section'; id: string };
	let dragging = $state<Drag | null>(null);
	let dropAt = $state<string | null>(null);

	const moveTask = (workOrderId: string, slot: TaskSlot) =>
		moveTaskCommand({ projectId, workOrderId, ...slot });
	const moveSections = (order: string[]) =>
		reorderSectionsCommand({ projectId, sectionIds: order });

	function startDrag(e: DragEvent, drag: Drag) {
		dragging = drag;
		e.dataTransfer?.setData('text/plain', drag.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function endDrag() {
		dragging = null;
		dropAt = null;
	}
	function overTask(e: DragEvent, key: string) {
		if (dragging?.kind !== 'task') return;
		e.preventDefault();
		dropAt = key;
	}
	function dropTask(e: DragEvent, sectionId: string | null, beforeId: string | null) {
		if (dragging?.kind !== 'task') return;
		e.preventDefault();
		const id = dragging.id;
		endDrag();
		if (id !== beforeId) void moveTask(id, dropSlot(list, id, { sectionId, beforeId }));
	}
	function overSection(e: DragEvent, sectionId: string | null) {
		if (dragging?.kind === 'task') return overTask(e, `head:${sectionId}`);
		if (dragging?.kind !== 'section' || !sectionId) return;
		e.preventDefault();
		dropAt = `head:${sectionId}`;
	}
	function dropOnSection(e: DragEvent, sectionId: string | null) {
		if (dragging?.kind === 'task') return dropTask(e, sectionId, null);
		if (dragging?.kind !== 'section' || !sectionId) return;
		e.preventDefault();
		const order = dropSection(sectionIds, dragging.id, sectionId);
		endDrag();
		if (order) void moveSections(order);
	}
	function stepKey(e: KeyboardEvent): -1 | 1 | null {
		return e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : null;
	}
	function taskKey(e: KeyboardEvent, id: string) {
		const delta = stepKey(e);
		if (!delta) return;
		e.preventDefault();
		const slot = stepTask(list, id, delta);
		if (slot) void moveTask(id, slot);
	}
	function sectionKey(e: KeyboardEvent, id: string) {
		const delta = stepKey(e);
		if (!delta) return;
		e.preventDefault();
		const order = stepSection(sectionIds, id, delta);
		if (order) void moveSections(order);
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<TabBar
		collapse="always"
		tabs={TASK_FILTERS.map((key) => ({ key, label: TASK_FILTER_LABELS[key] }))}
		active={filter}
		onchange={(key) => onfilter(key as TaskFilter)}
	/>
	<Button variant="ghost" size="sm" aria-pressed={!showDone} onclick={() => onshowdone(!showDone)}>
		{showDone ? 'Hide done' : `Show done${hiddenDone > 0 ? ` (${hiddenDone})` : ''}`}
	</Button>
</div>

{#if list.tasks.length === 0 && list.sections.length === 0}
	<EmptyState
		title="No tasks yet"
		description="Apply a duty list to start one, or add tasks to a section."
	/>
{:else}
	<Table zebra={false}>
		{#snippet head()}
			<th class="w-px"><span class="sr-only">Done</span></th>
			<th class="cell-primary">Task</th>
			<th>Assigned</th>
			<th class="col-support">When</th>
			<th class="col-support cell-num">Cost</th>
		{/snippet}
		{#each groups as g (g.section?.id ?? 'loose')}
			{@const sid = g.section?.id ?? null}
			<tr
				class="bg-base-200 {dropAt === `head:${sid}` ? 'drop-target' : ''}"
				ondragover={(e) => overSection(e, sid)}
				ondrop={(e) => dropOnSection(e, sid)}
			>
				<th colspan="5" class="font-semibold">
					<div class="flex items-center gap-1">
						{#if g.section}
							{@const name = g.section.name}
							<Button
								variant="ghost"
								size="xs"
								shape="square"
								class="depth-0 cursor-grab"
								draggable="true"
								aria-label="Move the {name} section: drag it, or press the up and down arrows"
								ondragstart={(e: DragEvent) => startDrag(e, { kind: 'section', id: sid! })}
								ondragend={endDrag}
								onkeydown={(e: KeyboardEvent) => sectionKey(e, sid!)}
							>
								<IconGripVertical size={14} />
							</Button>
						{/if}
						<span>{g.section?.name ?? 'No section'}</span>
						<span class="text-muted font-normal">{g.done}/{g.total}</span>
						{#if g.section}
							<span class="ms-auto">
								<SectionMenu {projectId} section={g.section} {sectionIds} taskCount={g.total} />
							</span>
						{/if}
					</div>
				</th>
			</tr>
			{#each g.tasks as t (t.id)}
				{@const when = whenOf(t)}
				<tr
					class="hover cursor-pointer {selectedId === t.id ? 'bg-base-200' : ''} {dropAt === t.id
						? 'drop-target'
						: ''}"
					aria-current={selectedId === t.id ? 'true' : undefined}
					onclick={(e) => rowClick(e, t.id)}
					ondragover={(e) => overTask(e, t.id)}
					ondrop={(e) => dropTask(e, sid, t.id)}
				>
					<td class="w-px">
						<div class="flex w-max items-center">
							<Button
								variant="ghost"
								size="xs"
								shape="square"
								class="depth-0 cursor-grab"
								draggable="true"
								aria-label="Move {t.title}: drag it, or press the up and down arrows"
								ondragstart={(e: DragEvent) => startDrag(e, { kind: 'task', id: t.id })}
								ondragend={endDrag}
								onkeydown={(e: KeyboardEvent) => taskKey(e, t.id)}
							>
								<IconGripVertical size={14} />
							</Button>
							<TaskCheckControl task={t} {projectId} place="row" {onopen} />
						</div>
					</td>
					<td class="cell-primary">
						<a
							href={withQuery(resolve(`/staff/projects/${projectId}`), `task=${t.id}`)}
							class="block truncate font-medium {t.cancelledAt ? 'text-subtle line-through' : ''}"
							onclick={(e) => open(e, t.id)}>{t.title}</a
						>
						{#if t.duties.total > 0 || t.roleName}
							<div class="truncate text-subtle">
								{#if t.duties.total > 0}
									<Button
										variant="link"
										size="xs"
										class="depth-0 px-0"
										aria-expanded={unfolded.has(t.id)}
										aria-label="{unfolded.has(t.id) ? 'Fold' : 'Unfold'} the duties of {t.title}"
										onclick={() => toggleDuties(t.id)}
									>
										{#if unfolded.has(t.id)}
											<IconChevronDown size={12} />
										{:else}
											<IconChevronRight size={12} />
										{/if}
										{t.duties.done}/{t.duties.total} duties
									</Button>
								{/if}
								{#if t.roleName && t.mode !== 'contractor'}{t.roleName}{/if}
							</div>
						{/if}
					</td>
					<td><AssignPicker task={t} {projectId} place="row" /></td>
					<td class="col-support whitespace-nowrap">
						<span
							class="inline-flex items-center gap-1 {when.kind === 'none' ? 'text-subtle' : ''}"
						>
							{when.label}
							{#if when.endsAfterDue}
								<IconFlag size={14} class="text-warning" aria-label="Ends after its due date" />
							{/if}
						</span>
					</td>
					<td class="col-support cell-num">{costOf(t)}</td>
				</tr>
				{#if unfolded.has(t.id)}
					<tr>
						<td></td>
						<td colspan="4">
							<div class="border-s-2 border-base-300 ps-3">
								<DutyItems task={t} {projectId} place="row" />
							</div>
						</td>
					</tr>
				{/if}
			{:else}
				<tr>
					<td></td>
					<td colspan="4" class="text-subtle">
						{g.total > 0 ? 'Nothing here matches the filter.' : 'No tasks yet.'}
					</td>
				</tr>
			{/each}
			<tr>
				<td></td>
				<td colspan="4">
					<AddTaskLine {projectId} sectionId={sid} sectionName={g.section?.name ?? 'no section'} />
				</td>
			</tr>
		{/each}
	</Table>
{/if}

<Action
	action={addSection}
	label="Add section"
	variant="ghost"
	size="sm"
	modalTitle="Add a section"
	submitLabel="Add section"
	successToast="Section added"
>
	{#snippet form()}
		<input {...addSection.fields.projectId.as('hidden', projectId)} />
		<Field field={addSection.fields.name} type="text" label="Name" />
	{/snippet}
</Action>

<style>
	.drop-target {
		box-shadow: inset 0 2px 0 var(--color-primary);
	}
</style>
