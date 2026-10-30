<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import { getProjectsPage, createProjectForm } from '$lib/remote/projects.remote';
	import type { ProjectView } from '$lib/config';
	import ProjectsTable from './ProjectsTable.svelte';
	import ProjectViews from './ProjectViews.svelte';

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
</script>

<PageHeader title="Projects">
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
	<ProjectViews active="projects" />
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
		<ProjectsTable projects={data.projects} {view} />
		<Pagination total={data.projects.length} unit="projects" />
	{/if}
</PageContent>
