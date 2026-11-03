<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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

<PageHeader title={m.staff_projects()}>
	<Action
		action={createProjectForm}
		label={m.staff_projects_new_project()}
		modalTitle={m.staff_projects_new_project()}
		successToast={m.staff_projects_success_toast()}
	>
		{#snippet form()}
			<Field
				field={fields.name}
				type="text"
				label={m.staff_name()}
				description={m.staff_projects_what_work_live_room_refresh()}
			/>
			<Field field={fields.description} type="textarea" label={m.staff_description()} />
			<Field
				field={fields.groupId}
				type="select"
				label={m.staff_owning_committee()}
				options={committeeOptions}
				description={m.staff_projects_only_committee_can_own_project()}
			/>
			<MoneyField field={fields.budgetCents} label={m.staff_budget()} />
			<Field field={fields.startsAt} type="date" label={m.staff_starts()} />
			<Field field={fields.endsAt} type="date" label={m.staff_ends()} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	<ProjectViews active="projects" />
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		<Select
			size="sm"
			aria-label={m.staff_show()}
			value={view}
			onchange={(e: Event) => {
				view = (e.currentTarget as HTMLSelectElement).value as ProjectView;
			}}
		>
			<option value="active">{m.staff_active()}</option>
			<option value="archived">{m.staff_archived()}</option>
			<option value="all">{m.staff_projects_active_archived()}</option>
		</Select>
		<Select
			size="sm"
			aria-label={m.staff_committee()}
			value={committeeFilter}
			onchange={(e: Event) => {
				committeeFilter = (e.currentTarget as HTMLSelectElement).value;
			}}
		>
			<option value="">{m.staff_projects_all_committees()}</option>
			{#each data.committees as c (c.id)}
				<option value={c.id}>{c.name}</option>
			{/each}
		</Select>
	</FilterBar>

	{#if data.projects.length === 0}
		<EmptyState
			title={view === 'archived'
				? m.staff_projects_no_archived_projects()
				: m.staff_projects_no_projects()}
			description={m.staff_projects_start_one_when_work_spans()}
		/>
	{:else}
		<ProjectsTable projects={data.projects} {view} />
		<Pagination total={data.projects.length} unit="projects" />
	{/if}
</PageContent>
