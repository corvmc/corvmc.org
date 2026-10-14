<script lang="ts">
	import Table from '$lib/components/ui/Table.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import {
		IconChevronDown,
		IconChevronRight,
		IconFlag,
		IconSquare,
		IconSquareCheck
	} from '@tabler/icons-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import AssignedSummary from './AssignedSummary.svelte';
	import TaskCheck from './TaskCheck.svelte';
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
		if ((event.target as HTMLElement).closest('a,button,input,label,[data-no-row-click]')) return;
		if (window.getSelection()?.toString()) return;
		onopen(id);
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<TabBar
		collapse
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
			<tr class="bg-base-200">
				<th colspan="5" class="font-semibold">
					{g.section?.name ?? 'No section'}
					<span class="ml-1 text-muted font-normal">{g.done}/{g.total}</span>
				</th>
			</tr>
			{#each g.tasks as t (t.id)}
				{@const when = whenOf(t)}
				<tr
					class="hover cursor-pointer {selectedId === t.id ? 'bg-base-200' : ''}"
					aria-current={selectedId === t.id ? 'true' : undefined}
					onclick={(e) => rowClick(e, t.id)}
				>
					<td class="w-px"><TaskCheck task={t} /></td>
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
										class="px-0"
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
					<td><AssignedSummary task={t} /></td>
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
					{#each t.dutyItems as d (d.id)}
						<tr>
							<td></td>
							<td colspan="4" class="ps-10">
								<span
									class="inline-flex items-center gap-2 {d.done ? 'line-through opacity-60' : ''}"
								>
									{#if d.done}
										<IconSquareCheck size={16} aria-label="Done" />
									{:else}
										<IconSquare size={16} aria-label="Not done" />
									{/if}
									{d.label}
								</span>
							</td>
						</tr>
					{/each}
				{/if}
			{:else}
				<tr>
					<td></td>
					<td colspan="4" class="text-subtle">
						{g.total > 0 ? 'Nothing here matches the filter.' : 'No tasks yet.'}
					</td>
				</tr>
			{/each}
		{/each}
	</Table>
{/if}
