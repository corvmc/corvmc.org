<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { getProjectsPage } from '#lib/remote/projects.remote.js';
	import type { ProjectView } from '#lib/config.js';
	import ProjectsTable from './ProjectsTable.svelte';
	import StaffViews from '../../StaffViews.svelte';
	import NewProjectAction from '../NewProjectAction.svelte';
	import { taskViews } from '../views';

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
	const activeFilterCount = $derived((view !== 'active' ? 1 : 0) + (committeeFilter ? 1 : 0));

	function clearFilters() {
		view = 'active';
		committeeFilter = '';
	}
</script>

<PageHeader title={m.staff_tasks_title()}>
	<StaffViews views={taskViews} active="projects" collapse />
</PageHeader>

<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		<Select
			size="sm"
			aria-label={m.staff_show_label()}
			value={view}
			onchange={(e: Event) => {
				view = (e.currentTarget as HTMLSelectElement).value as ProjectView;
			}}
		>
			<option value="active">{m.staff_active_label()}</option>
			<option value="archived">{m.staff_archived_label()}</option>
			<option value="all">{m.staff_projects_active_archived_label()}</option>
		</Select>
		<Select
			size="sm"
			aria-label={m.staff_committee_label()}
			value={committeeFilter}
			onchange={(e: Event) => {
				committeeFilter = (e.currentTarget as HTMLSelectElement).value;
			}}
		>
			<option value="">{m.staff_projects_all_committees_label()}</option>
			{#each data.committees as c (c.id)}
				<option value={c.id}>{c.name}</option>
			{/each}
		</Select>
		{#snippet actions()}
			<NewProjectAction committees={data.committees} templates={data.templates} />
		{/snippet}
	</FilterBar>

	{#if data.projects.length === 0}
		<EmptyState
			title={view === 'archived'
				? m.staff_projects_no_archived_projects_title()
				: m.staff_projects_no_projects_title()}
			description={m.staff_projects_start_one_when_work_spans_body()}
		/>
	{:else}
		<ProjectsTable projects={data.projects} {view} />
		<Pagination total={data.projects.length} unit="projects" />
	{/if}
</PageContent>
