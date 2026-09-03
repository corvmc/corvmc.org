<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import { getProjectsPage, createProjectForm } from '$lib/remote/projects.remote';
	import { projectStatuses, projectStatusLabels, type ProjectStatus } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	/**
	 * Every body of work with a budget and an owner.
	 *
	 * Budget and burn sit in the same column rather than two, because the only
	 * question anyone brings to this table is whether a project is inside its
	 * budget — and two columns make the reader do the subtraction. Over-budget
	 * is coloured; under-budget is not, since "fine" needs no emphasis.
	 */
	let statusFilter = $state<ProjectStatus | ''>('');
	let committeeFilter = $state('');

	const filters = $derived({
		status: (statusFilter || undefined) as ProjectStatus | undefined,
		groupId: committeeFilter || undefined
	});

	const data = $derived(await getProjectsPage(filters));
	const { fields } = createProjectForm;

	const committeeOptions = $derived(data.committees.map((c) => ({ value: c.id, label: c.name })));
	const activeFilterCount = $derived((statusFilter ? 1 : 0) + (committeeFilter ? 1 : 0));

	function clearFilters() {
		statusFilter = '';
		committeeFilter = '';
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
			aria-label="Status"
			value={statusFilter}
			onchange={(e: Event) => {
				statusFilter = (e.currentTarget as HTMLSelectElement).value as ProjectStatus | '';
			}}
		>
			<option value="">All statuses</option>
			{#each projectStatuses as s (s)}
				<option value={s}>{projectStatusLabels[s]}</option>
			{/each}
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
			title="No projects"
			description="Start one when work spans more than a single job — a facility improvement, a festival, or anything with a budget to watch."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Project</th>
				<th>Owner</th>
				<th>Status</th>
				<th>Dates</th>
				<th class="cell-num">Budget</th>
				<th class="cell-num">Spent</th>
			{/snippet}
			{#each data.projects as row (row.project.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/projects/${row.project.id}`)}>
							{row.project.name}
						</a>
						{#if row.burn.contributed.volunteerMinutes > 0}
							<div class="text-subtle">
								{Math.round(row.burn.contributed.volunteerMinutes / 60)} volunteer hours
							</div>
						{/if}
					</td>
					<td>{row.committeeName ?? 'Unowned'}</td>
					<td><StatusBadge status={row.project.status} label /></td>
					<td>
						{#if row.project.startsAt}
							{formatDateShort(row.project.startsAt)}
							{row.project.endsAt ? ` – ${formatDateShort(row.project.endsAt)}` : ' onward'}
						{:else}
							—
						{/if}
					</td>
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
	{/if}
</PageContent>
