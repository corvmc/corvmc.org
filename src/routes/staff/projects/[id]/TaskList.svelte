<script lang="ts">
	import Table from '$lib/components/ui/Table.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		IconCaretDownFilled,
		IconCaretRightFilled,
		IconCheck,
		IconChevronDown,
		IconChevronRight,
		IconEye,
		IconEyeOff,
		IconFilter,
		IconGripVertical,
		IconPlus
	} from '@tabler/icons-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import {
		createSectionForm,
		createTaskForm,
		moveTaskCommand,
		reorderSectionsCommand
	} from '$lib/remote/tasks.remote';
	import AddTaskLine from './AddTaskLine.svelte';
	import AssignPicker from './AssignPicker.svelte';
	import DutyItems from './DutyItems.svelte';
	import SectionMenu from './SectionMenu.svelte';
	import TaskCheckControl from './TaskCheckControl.svelte';
	import TaskWhen from './TaskWhen.svelte';
	import { dropSection, dropSlot, stepSection, stepTask, type TaskSlot } from './task-order';
	import {
		TASK_FILTERS,
		TASK_FILTER_LABELS,
		costOf,
		groupBySection,
		isDone,
		matchesFilter,
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

	/** Sections folded shut, keyed like the groups. Local for the same reason. */
	const folded = new SvelteSet<string>();
	function toggleSection(key: string) {
		if (folded.has(key)) folded.delete(key);
		else folded.add(key);
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
	const addTask = createTaskForm;

	let filterMenu = $state<HTMLDetailsElement>();
	function pickFilter(key: TaskFilter) {
		onfilter(key);
		if (filterMenu) filterMenu.open = false;
	}

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
	<Action
		action={addTask}
		label="Add task"
		variant="primary"
		size="sm"
		modalTitle="Add a task"
		submitLabel="Add task"
		successToast="Task added"
	>
		{#snippet icon()}<IconPlus size={16} />{/snippet}
		{#snippet form()}
			<input {...addTask.fields.projectId.as('hidden', projectId)} />
			<input {...addTask.fields.sectionId.as('hidden', '')} />
			<Field field={addTask.fields.title} type="text" label="Title" />
		{/snippet}
	</Action>
	<Action
		action={addSection}
		label="Add section"
		variant="ghost"
		size="sm"
		class="depth-0 bare bare-hover"
		modalTitle="Add a section"
		submitLabel="Add section"
		successToast="Section added"
	>
		{#snippet form()}
			<input {...addSection.fields.projectId.as('hidden', projectId)} />
			<Field field={addSection.fields.name} type="text" label="Name" />
		{/snippet}
	</Action>
	<div class="ms-auto flex items-center gap-1">
		<details class="dropdown dropdown-end" bind:this={filterMenu}>
			<summary class="depth-0 bare bare-hover btn btn-ghost font-normal btn-sm">
				<IconFilter size={16} />
				{filter === 'all' ? 'Filter' : `Filter: ${TASK_FILTER_LABELS[filter]}`}
			</summary>
			<div class="dropdown-content dropdown-panel flex w-56 flex-col gap-1">
				{#each TASK_FILTERS as key (key)}
					<Button
						variant="ghost"
						size="sm"
						class="justify-start font-normal"
						aria-pressed={filter === key}
						onclick={() => pickFilter(key)}
					>
						<span class="inline-flex w-4">
							{#if filter === key}<IconCheck size={14} />{/if}
						</span>
						{TASK_FILTER_LABELS[key]}
					</Button>
				{/each}
			</div>
		</details>
		<Button
			variant="ghost"
			size="sm"
			class="depth-0 bare bare-hover font-normal"
			aria-pressed={!showDone}
			onclick={() => onshowdone(!showDone)}
		>
			{#if showDone}<IconEyeOff size={16} />{:else}<IconEye size={16} />{/if}
			{showDone ? 'Hide done' : `Show done${hiddenDone > 0 ? ` (${hiddenDone})` : ''}`}
		</Button>
	</div>
</div>

{#if list.tasks.length === 0 && list.sections.length === 0}
	<EmptyState
		title="No tasks yet"
		description="Apply a template, add a task, or add a section to group them."
	/>
{:else}
	<!-- Inset from the left: the drag grips live in that gutter, shown on row hover or focus. -->
	<Table zebra={false} packed={false} class="task-table">
		{#snippet head()}
			<th class="cell-primary">Task</th>
			<th class="col-support">Role</th>
			<th>Assigned</th>
			<th class="col-support">When</th>
			<th class="col-support cell-num">Cost</th>
		{/snippet}
		{#each groups as g (g.section?.id ?? 'loose')}
			{@const sid = g.section?.id ?? null}
			{@const key = sid ?? 'loose'}
			{@const name = g.section?.name ?? 'No section'}
			{@const expanded = !folded.has(key)}
			<tr
				class="section-row group {dropAt === `head:${sid}` ? 'drop-target' : ''}"
				ondragover={(e) => overSection(e, sid)}
				ondrop={(e) => dropOnSection(e, sid)}
			>
				<th colspan="5">
					<div class="relative flex items-center gap-1">
						{#if g.section}
							<Button
								variant="ghost"
								size="xs"
								shape="square"
								class="gutter-control depth-0 bare absolute right-full cursor-grab"
								draggable="true"
								aria-label="Move the {name} section: drag it, or press the up and down arrows"
								ondragstart={(e: DragEvent) => startDrag(e, { kind: 'section', id: sid! })}
								ondragend={endDrag}
								onkeydown={(e: KeyboardEvent) => sectionKey(e, sid!)}
							>
								<IconGripVertical size={14} />
							</Button>
						{/if}
						<Button
							variant="ghost"
							size="xs"
							shape="square"
							class="depth-0 bare"
							aria-expanded={expanded}
							aria-label="{expanded ? 'Collapse' : 'Expand'} the {name} section"
							onclick={() => toggleSection(key)}
						>
							{#if expanded}
								<IconCaretDownFilled size={14} />
							{:else}
								<IconCaretRightFilled size={14} />
							{/if}
						</Button>
						<span class="text-lg font-semibold">{name}</span>
						<span class="text-muted font-normal">{g.done}/{g.total}</span>
						{#if g.section}
							<span class="ms-auto">
								<SectionMenu {projectId} section={g.section} {sectionIds} taskCount={g.total} />
							</span>
						{/if}
					</div>
				</th>
			</tr>
			{#if expanded}
				{#each g.tasks as t (t.id)}
					{@const href = withQuery(resolve(`/staff/projects/${projectId}`), `task=${t.id}`)}
					<tr
						class="task-row group cursor-pointer {selectedId === t.id
							? 'bg-base-200'
							: ''} {dropAt === t.id ? 'drop-target' : ''}"
						aria-current={selectedId === t.id ? 'true' : undefined}
						onclick={(e) => rowClick(e, t.id)}
						ondragover={(e) => overTask(e, t.id)}
						ondrop={(e) => dropTask(e, sid, t.id)}
					>
						<td class="cell-primary">
							<!-- A grid, not a flex row: the tick and chevron keep their tracks and only the title truncates. -->
							<div class="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
								<Button
									variant="ghost"
									size="xs"
									shape="square"
									class="gutter-control depth-0 bare absolute right-full cursor-grab"
									draggable="true"
									aria-label="Move {t.title}: drag it, or press the up and down arrows"
									ondragstart={(e: DragEvent) => startDrag(e, { kind: 'task', id: t.id })}
									ondragend={endDrag}
									onkeydown={(e: KeyboardEvent) => taskKey(e, t.id)}
								>
									<IconGripVertical size={14} />
								</Button>
								<TaskCheckControl task={t} {projectId} place="row" {onopen} />
								<div class="min-w-0">
									<a
										{href}
										class="task-title block max-w-full truncate font-medium {t.cancelledAt
											? 'text-subtle line-through'
											: ''}"
										onclick={(e) => open(e, t.id)}>{t.title}</a
									>
									{#if t.duties.total > 0 || (t.engagement && list.contractorMoney)}
										<div class="truncate text-subtle">
											{#if t.duties.total > 0}
												<Button
													variant="link"
													size="xs"
													class="duties-toggle depth-0 bare me-2"
													aria-expanded={unfolded.has(t.id)}
													aria-label="{unfolded.has(t.id)
														? 'Fold'
														: 'Unfold'} the duties of {t.title}"
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
											{#if t.mode === 'contractor' && t.engagement && list.contractorMoney}
												<a class="link" href={resolve(`/staff/contractors/jobs/${t.engagement.id}`)}
													>{t.engagement.invoiceRef
														? `Invoice ${t.engagement.invoiceRef}`
														: 'Contractor job'}</a
												>
											{/if}
										</div>
									{/if}
								</div>
								<a
									{href}
									class="gutter-control flex shrink-0 items-center rounded-sm p-0.5 text-subtle hover:bg-base-300"
									aria-label="Open the details of {t.title}"
									onclick={(e) => open(e, t.id)}
								>
									<IconChevronRight size={16} />
								</a>
							</div>
						</td>
						<td class="col-support whitespace-nowrap">
							{#if t.roleName && t.mode !== 'contractor'}{t.roleName}{:else}<span class="text-fg-3"
									>—</span
								>{/if}
						</td>
						<td><AssignPicker task={t} {projectId} place="row" /></td>
						<td class="col-support whitespace-nowrap"><TaskWhen task={t} /></td>
						<td class="col-support cell-num">{costOf(t)}</td>
					</tr>
					{#if unfolded.has(t.id)}
						<tr class="detail-row">
							<td colspan="5" class="ps-8">
								<DutyItems task={t} {projectId} place="row" />
							</td>
						</tr>
					{/if}
				{:else}
					<tr class="detail-row">
						<td colspan="5" class="ps-8 text-subtle">
							{g.total > 0 ? 'Nothing here matches the filter.' : 'No tasks yet.'}
						</td>
					</tr>
				{/each}
				<tr class="detail-row">
					<td colspan="5" class="ps-8">
						<AddTaskLine
							{projectId}
							sectionId={sid}
							sectionName={g.section?.name ?? 'no section'}
						/>
					</td>
				</tr>
			{/if}
		{/each}
	</Table>
{/if}

<style>
	.drop-target {
		box-shadow: inset 0 2px 0 var(--color-primary);
	}
	/* The gutter the grips sit in; the table gives up that much width. */
	:global(.task-table) {
		margin-inline-start: 1.5rem;
		width: calc(100% - 1.5rem);
	}
	:global(.task-table thead) {
		color: var(--panel-subtle, var(--fg-2));
		font-weight: 400;
	}
	:global(.task-table tr) {
		border-bottom: 1px solid var(--panel-line, var(--color-base-300));
	}
	/* Light vertical gridlines; a one-cell row (section, duties, add) draws none. */
	:global(.task-table :is(th, td) + :is(th, td)) {
		border-inline-start: 1px solid var(--panel-line, var(--color-base-300));
	}
	.section-row th {
		padding-block-start: 1rem;
		background: transparent;
	}
	/* Only task rows tint on hover: a heading or an add line is not a row to open. */
	.section-row:hover,
	.detail-row:hover {
		background-color: transparent;
	}
	/* Hover-only controls, which focus also shows, so the keyboard can find them. */
	.group :global(.gutter-control) {
		opacity: 0;
	}
	.group:is(:hover, :focus-within) :global(.gutter-control),
	:global(.gutter-control:focus-visible) {
		opacity: 1;
	}
	.task-title {
		margin-inline: -0.25rem;
		padding-inline: 0.25rem;
		border-radius: var(--radius-selector);
	}
	.task-row:hover .task-title {
		box-shadow: 0 0 0 1px var(--panel-line, var(--color-base-300));
	}
	.task-row :global(.duties-toggle) {
		height: auto;
		min-height: 0;
		padding-inline: 0;
		font-weight: 400;
		color: inherit;
	}
</style>
