<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import { getProjectsPage, createProjectForm } from '$lib/remote/projects.remote';
	import { isProjectArchived, type ProjectView } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { rowLink } from '$lib/actions/row-link';

	/**
	 * Every body of work with a budget and an owner. Budget and burn share a
	 * column, because the only question brought to this table is whether a
	 * project is inside its budget, and two columns make the reader subtract.
	 * Over-budget is coloured; "fine" needs no emphasis. Progress is tasks done
	 * over tasks live; a project is active or archived (#1935).
	 */
	let view = $state<ProjectView>('active');
	let committeeFilter = $state('');

	const filters = $derived({
		view,
		groupId: committeeFilter || undefined
	});

	const data = $derived(await getProjectsPage(filters));
	const { fields } = createProjectForm;

	const committeeOptions = $derived(data.committees.map((c) => ({ value: c.id, label: c.name })));
	const activeFilterCount = $derived((view !== 'active' ? 1 : 0) + (committeeFilter ? 1 : 0));

	function clearFilters() {
		view = 'active';
		committeeFilter = '';
	}

	/** One line: "May 3 – 17", "May 3 – Jun 2", "May 3 onward". */
	function dateRange(start: Date | null, end: Date | null): string {
		if (!start) return '—';
		if (!end) return `${formatDateShort(start)} onward`;
		const [sm, sd] = formatDateShort(start).split(' ');
		const [em, ed] = formatDateShort(end).split(' ');
		return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
	}
</script>

<PageHeader title="Projects" subtitle="Work with a budget and an owner">
	<Action
		action={createProjectForm}
		label="New project"
		modalTitle="New project"
		successToast="Project created"
	>
		{#snippet form()}
			<Field
				field={fields.name}
				type="text"
				label="Name"
				description="What the work is — “Live room refresh”, “Winter showcase”."
			/>
			<Field field={fields.description} type="textarea" label="Description" />
			<Field
				field={fields.groupId}
				type="select"
				label="Owning committee"
				options={committeeOptions}
				description="Only a committee can own a project. Leave blank to decide later."
			/>
			<MoneyField field={fields.budgetCents} label="Budget" />
			<Field field={fields.startsAt} type="date" label="Starts" />
			<Field field={fields.endsAt} type="date" label="Ends" />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		<Select
			size="sm"
			aria-label="Show"
			value={view}
			onchange={(e: Event) => {
				view = (e.currentTarget as HTMLSelectElement).value as ProjectView;
			}}
		>
			<option value="active">Active</option>
			<option value="archived">Archived</option>
			<option value="all">Active and archived</option>
		</Select>
		<Select
			size="sm"
			aria-label="Committee"
			value={committeeFilter}
			onchange={(e: Event) => {
				committeeFilter = (e.currentTarget as HTMLSelectElement).value;
			}}
		>
			<option value="">All committees</option>
			{#each data.committees as c (c.id)}
				<option value={c.id}>{c.name}</option>
			{/each}
		</Select>
	</FilterBar>

	{#if data.projects.length === 0}
		<EmptyState
			title={view === 'archived' ? 'No archived projects' : 'No projects'}
			description="Start one when work spans more than a single job — a facility improvement, a festival, or anything with a budget to watch."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Project</th>
				<th>Committees</th>
				<th>Progress</th>
				<th>Dates</th>
				<th class="cell-num">Budget</th>
				<th class="cell-num">Spent</th>
			{/snippet}
			{#each data.projects as row (row.project.id)}
				<tr class="hover" use:rowLink={resolve(`/staff/projects/${row.project.id}`)}>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/projects/${row.project.id}`)}>
							{row.project.name}
						</a>
						{#if view === 'all' && isProjectArchived(row.project.status)}
							<Badge size="sm" variant="ghost">Archived</Badge>
						{/if}
						{#if row.burn.contributed.volunteerMinutes > 0}
							<div class="text-subtle">
								{Math.round(row.burn.contributed.volunteerMinutes / 60)} volunteer hours
							</div>
						{/if}
					</td>
					<td class="whitespace-nowrap" title={row.committeeNames.join(', ') || undefined}>
						{#if row.committeeNames.length === 0}
							<span class="text-muted">Unowned</span>
						{:else}
							{row.committeeNames[0]}
							{#if row.committeeNames.length > 1}
								<span class="text-muted">+{row.committeeNames.length - 1}</span>
							{/if}
						{/if}
					</td>
					<td class="whitespace-nowrap">
						{#if row.progress.total === 0}
							<span class="text-muted">No tasks</span>
						{:else}
							<span class="inline-flex items-center gap-2">
								<progress
									class="progress w-16 progress-success"
									value={row.progress.done}
									max={row.progress.total}
									aria-label="Tasks done"
								></progress>
								{Math.round((row.progress.done / row.progress.total) * 100)}%
							</span>
						{/if}
					</td>
					<td class="whitespace-nowrap">{dateRange(row.project.startsAt, row.project.endsAt)}</td>
					<td class="cell-num">
						{row.project.budgetCents === null ? 'None set' : formatCents(row.project.budgetCents)}
					</td>
					<td class="cell-num">
						<span
							class={row.burn.remainingCents !== null && row.burn.remainingCents < 0
								? 'font-medium text-error'
								: ''}
						>
							{formatCents(row.burn.cash.totalCents)}
						</span>
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={data.projects.length} unit="projects" />
	{/if}
</PageContent>
