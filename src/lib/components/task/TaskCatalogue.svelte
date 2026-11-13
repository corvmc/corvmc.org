<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The task table (#2625): every task, or with `projectId` one project's. Grouped
	 * by the date a task falls on (its shift's, else its deadline), by project, or
	 * on one project's list by its sections (#2653), where they are also managed. Assignment, a
	 * contractor and a shift's sign-ups all answer "who". Filters live in the URL
	 * of whichever page shows it.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { Latest } from '#lib/latest.svelte.js';
	import { formatDateShort, relativeDay } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE, projectKindLabels, projectStatusLabels } from '#lib/config.js';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import RoleOptions from '#lib/components/volunteer/RoleOptions.svelte';
	import NewTaskAction from '#lib/components/actions/NewTaskAction.svelte';
	import NewProjectAction from '#lib/components/actions/NewProjectAction.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import SectionMenu from './SectionMenu.svelte';
	import TaskRow from './TaskRow.svelte';
	import { isUnstaffed, type ContractorMark } from '#lib/utils/task-facts.js';
	import { createSectionForm, getTasksPage } from '#lib/remote/tasks.remote.js';
	import TaskRowActions from './TaskRowActions.svelte';
	import {
		CHIPS,
		WINDOWS,
		GROUPINGS,
		byWhen,
		effectiveGrouping,
		groupByProject,
		groupBySection,
		matchesChip,
		matchesKind,
		matchesTaskProject,
		matchesWindow,
		parseTaskQuery,
		taskQuerySearch,
		whenOf,
		type Chip,
		type Grouping,
		type Kind,
		type TaskQuery
	} from '#lib/utils/task-filters.js';

	let { projectId }: { projectId?: string } = $props();

	// Pinned at mount: the page this sits on does not change under it.
	const path = page.url.pathname;
	let q = $state<TaskQuery>(parseTaskQuery(page.url.searchParams));

	// Writes the URL, never state: `goto(..., { replace: true })`, since a shallow
	// `replaceState` updates neither `page.url` nor the router's entry.
	$effect(() => {
		const href = withQuery(path, taskQuerySearch(q));
		if (location.pathname + location.search !== href) {
			void goto(href, { replace: true, reset: false });
		}
	});

	// Pinned once, so "overdue" does not move while the page is open.
	const now = new Date();

	const args = $derived({
		projectId,
		volunteerRoleId: q.role || undefined,
		includeDone: q.done,
		...(q.about ? { about: q.about } : {})
	});
	// Not `{#await}`: a refresh would re-pend it and unmount an open row Action.
	const tasks = new Latest(() => getTasksPage(args));
	$effect(() => {
		if (tasks.error) throw tasks.error.e;
	});
	const refresh = () => void getTasksPage(args).refresh();
	// Per task, the open tasks it waits on, by name: the row's "waits on" line.
	const waitsOn = $derived(tasks.current?.waitsOn ?? {});

	type Row = Awaited<ReturnType<typeof getTasksPage>>['tasks'][number];

	const CHIP_LABELS: Record<Chip, () => string> = {
		unassigned: m.staff_tasks_unassigned_label,
		overdue: m.staff_overdue_label,
		blocked: m.staff_tasks_blocked_label,
		untimed: m.staff_tasks_no_time_label,
		invoice: m.staff_volunteer_schedule_awaiting_invoice_label
	};
	const KIND_LABELS: Record<Kind, () => string> = {
		timed: m.staff_tasks_kind_timed_label,
		untimed: m.staff_tasks_kind_untimed_label,
		recurring: m.staff_recurring_label,
		contractor: m.staff_contractor_label
	};

	const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE });
	const dayKey = (t: Row) => {
		const when = whenOf(t);
		return when ? dayFmt.format(when) : 'none';
	};
	const dayLabel = (t: Row) => {
		const when = whenOf(t);
		return when ? `${relativeDay(when)} · ${formatDateShort(when)}` : m.staff_tasks_no_date_label();
	};

	// One project's list neither groups nor filters by project; only it has sections.
	const sections = $derived(tasks.current?.sections ?? []);
	const grouping = $derived(
		effectiveGrouping(q.group, { project: !!projectId, sections: sections.length })
	);
	const sectionIds = $derived(sections.map((s) => s.id));
	const addSection = createSectionForm;
	const columns = $derived(projectId ? 5 : 6);
	const activeCount = $derived(
		(q.days !== 'all' ? 1 : 0) +
			(q.project && !projectId ? 1 : 0) +
			(q.role ? 1 : 0) +
			(q.kind ? 1 : 0) +
			(q.chip ? 1 : 0) +
			(q.done ? 1 : 0) +
			(q.about ? 1 : 0)
	);
	const select = (e: Event) => (e.currentTarget as HTMLSelectElement).value;
</script>

<FilterBar
	{activeCount}
	onclear={() => (q = { ...parseTaskQuery(new URLSearchParams()), group: q.group })}
>
	<Select
		size="sm"
		aria-label={m.staff_tasks_group_by_label()}
		value={grouping}
		data-testid="task-group"
		onchange={(e: Event) => {
			const value = select(e);
			q.group = (GROUPINGS as readonly string[]).includes(value) ? (value as Grouping) : '';
		}}
	>
		<option value="due">{m.staff_tasks_group_due_label()}</option>
		{#if projectId}
			<option value="section">{m.staff_tasks_section_label()}</option>
		{:else}
			<option value="project">{m.staff_project_label()}</option>
		{/if}
	</Select>
	<Select
		size="sm"
		aria-label={m.staff_volunteer_schedule_date_range_label()}
		value={String(q.days)}
		onchange={(e: Event) => {
			const n = Number(select(e));
			q.days = (WINDOWS as readonly number[]).includes(n) ? (n as TaskQuery['days']) : 'all';
		}}
	>
		<option value="all">{m.staff_tasks_any_date_label()}</option>
		{#each WINDOWS as days (days)}
			<option value={String(days)}>{m.staff_tasks_within_days_label({ days })}</option>
		{/each}
	</Select>
	{#if !projectId}
		<Select
			size="sm"
			aria-label={m.staff_project_label()}
			value={q.project}
			onchange={(e: Event) => (q.project = select(e))}
		>
			<option value="">{m.staff_tasks_all_projects_label()}</option>
			<option value="none">{m.staff_tasks_no_project_label()}</option>
			{#each tasks.current?.projects ?? [] as p (p.id)}
				<option value={p.id}>{p.name}</option>
			{/each}
		</Select>
	{/if}
	<Select
		size="sm"
		aria-label={m.staff_role_label()}
		value={q.role}
		onchange={(e: Event) => (q.role = select(e))}
	>
		<option value="">{m.staff_all_roles_label()}</option>
		<RoleOptions />
	</Select>
	<Select
		size="sm"
		aria-label={m.staff_kind_label()}
		value={q.kind}
		onchange={(e: Event) =>
			(q.kind = parseTaskQuery(new URLSearchParams({ kind: select(e) })).kind)}
	>
		<option value="">{m.staff_tasks_all_kinds_label()}</option>
		{#each Object.entries(KIND_LABELS) as [value, label] (value)}
			{#if value !== 'contractor' || tasks.current?.contractorAccess}
				<option {value}>{label()}</option>
			{/if}
		{/each}
	</Select>
	<Select
		size="sm"
		aria-label={m.staff_status_label()}
		value={q.done ? 'all' : 'open'}
		onchange={(e: Event) => (q.done = select(e) === 'all')}
	>
		<option value="open">{m.staff_open_label()}</option>
		<option value="all">{m.staff_tasks_open_and_done_label()}</option>
	</Select>

	{#snippet actions()}
		{#if tasks.current}
			{#if !projectId}
				<NewProjectAction
					committees={tasks.current.committees}
					templates={tasks.current.templates}
				/>
			{/if}
			<NewTaskAction projects={tasks.current.projects} {projectId} {sections} />
			{#if projectId}
				<Action
					action={addSection}
					label={m.staff_tasks_add_section_label()}
					variant="ghost"
					modalTitle={m.staff_tasks_add_section_title()}
					successToast={m.staff_tasks_section_added_toast()}
					onsuccess={refresh}
				>
					{#snippet form()}
						<input {...addSection.fields.projectId.as('hidden', projectId)} />
						<Field field={addSection.fields.name} type="text" label={m.staff_name_label()} />
					{/snippet}
				</Action>
			{/if}
		{/if}
	{/snippet}
</FilterBar>

{#if tasks.current}
	{@const data = tasks.current}
	{@const marksOf = (t: Row) => data.contractors[t.id] ?? []}
	{@const filtered = data.tasks
		.filter(
			(t) =>
				matchesWindow(q.days, t, now) &&
				(projectId || matchesTaskProject(q.project, t)) &&
				matchesKind(q.kind, t, marksOf(t))
		)
		.sort(byWhen)}
	<!-- Done work owing an invoice rides along for its chip, and shows only under it. -->
	{@const listed = filtered.filter((t) => q.done || q.chip === 'invoice' || !t.resolvedAt)}
	{@const shown = q.chip
		? listed.filter((t) => matchesChip(q.chip as Chip, t, marksOf(t), now))
		: listed}

	<div class="flex flex-wrap gap-2" data-testid="task-chips">
		{#each CHIPS as chip (chip)}
			{@const n = filtered.filter((t) => matchesChip(chip, t, marksOf(t), now)).length}
			{#if n > 0 || q.chip === chip}
				<Button
					size="sm"
					variant={q.chip === chip ? 'primary' : 'ghost'}
					aria-pressed={q.chip === chip}
					data-chip={chip}
					onclick={() => (q.chip = q.chip === chip ? '' : chip)}
				>
					{CHIP_LABELS[chip]()}
					<Badge size="sm">{n}</Badge>
				</Button>
			{/if}
		{/each}
	</div>

	<!-- With no filter on, an empty section still shows, to be added to or renamed. -->
	{@const sectioned =
		grouping === 'section' ? groupBySection(sections, shown, activeCount === 0) : []}

	{#if shown.length === 0 && sectioned.length === 0}
		<EmptyState title={m.staff_tasks_no_tasks_title()} />
	{:else}
		<!-- No zebra: the group rows are the striping, as on Reservations. -->
		<Table zebra={false}>
			{#snippet head()}
				<th>{m.staff_task_label()}</th>
				{#if !projectId}
					<th class="col-support">{m.staff_project_label()}</th>
				{/if}
				<th class="whitespace-nowrap">{m.staff_due_label()}</th>
				<th class="col-support">{m.staff_tasks_who_label()}</th>
				<th>{m.staff_status_label()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
			{/snippet}

			{#if grouping === 'section'}
				{#each sectioned as group (group.section?.id ?? 'none')}
					<tr data-testid="task-group-row" data-section={group.section?.id ?? 'none'}>
						<td colspan={columns} class="cell-group">
							<div class="flex w-max items-center gap-2">
								<span>
									{group.section?.name ?? m.staff_tasks_no_section_text()}
									<span class="text-subtle font-normal">
										· {m.staff_tasks_open_count_text({
											count: group.rows.filter((t) => !t.resolvedAt).length
										})}
									</span>
								</span>
								<NewTaskAction
									projects={data.projects}
									{projectId}
									{sections}
									section={group.section}
								/>
								{#if group.section && projectId}
									<SectionMenu
										{projectId}
										section={group.section}
										{sectionIds}
										taskCount={data.tasks.filter((t) => t.sectionId === group.section?.id).length}
										onsuccess={refresh}
									/>
								{/if}
							</div>
						</td>
					</tr>
					{#each group.rows as t (t.id)}
						{@render row(t, marksOf(t))}
					{/each}
				{/each}
			{:else if grouping === 'project'}
				{#each groupByProject(shown) as group (group.projectId ?? 'none')}
					{@const first = group.rows[0]}
					<tr data-testid="task-group-row">
						<td colspan={columns} class="cell-group">
							{#if group.projectId && first.projectKind && first.projectStatus}
								<a
									class="link"
									href={resolve('/staff/tasks/projects/[id]', { id: group.projectId })}
									>{first.projectName}</a
								>
								<span class="text-subtle font-normal">
									· {projectKindLabels[first.projectKind]} · {projectStatusLabels[
										first.projectStatus
									]} · {m.staff_tasks_open_count_text({
										count: group.rows.filter((t) => !t.resolvedAt).length
									})}
								</span>
							{:else}
								{m.staff_tasks_no_project_text()}
							{/if}
						</td>
					</tr>
					{#each group.rows as t (t.id)}
						{@render row(t, marksOf(t))}
					{/each}
				{/each}
			{:else}
				{#each shown as t, idx (t.id)}
					{#if idx === 0 || dayKey(shown[idx - 1]) !== dayKey(t)}
						<tr data-testid="task-group-row">
							<td colspan={columns} class="cell-group">{dayLabel(t)}</td>
						</tr>
					{/if}
					{@render row(t, marksOf(t))}
				{/each}
			{/if}
		</Table>
	{/if}
{/if}

{#snippet row(t: Row, marks: ContractorMark[])}
	<TaskRow task={t} {marks} {now} project={!projectId} waitsOn={waitsOn[t.id] ?? []}>
		{#snippet actions({ label, href })}
			{#if !t.resolvedAt}
				<TaskRowActions
					task={t}
					{label}
					{href}
					unassigned={isUnstaffed(t, marks)}
					onsuccess={refresh}
				/>
			{/if}
		{/snippet}
	</TaskRow>
{/snippet}
