<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { getProjectsPage, createProjectForm } from '#lib/remote/projects.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ProjectView } from '#lib/config.js';
	import ProjectsTable from './ProjectsTable.svelte';
	import StaffViews from '../StaffViews.svelte';
	import { projectViews } from './views';

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
	const templateOptions = $derived(data.templates.map((t) => ({ value: t.id, label: t.name })));
	const activeFilterCount = $derived((view !== 'active' ? 1 : 0) + (committeeFilter ? 1 : 0));

	function clearFilters() {
		view = 'active';
		committeeFilter = '';
	}
</script>

<PageHeader title={m.staff_projects_title()}>
	<StaffViews views={projectViews} active="projects" />
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
			<Action
				action={createProjectForm}
				label={m.staff_projects_new_project_label()}
				modalTitle={m.staff_projects_new_project_title()}
				successToast={m.staff_projects_success_toast()}
				onsuccess={(result) => {
					// A show leaves this list once it has a listing, so land on the project.
					const id = (result as { id?: string } | undefined)?.id;
					if (id) void goto(resolve(`staff/projects/${id}`));
				}}
			>
				{#snippet form()}
					<Field
						field={fields.name}
						type="text"
						label={m.staff_name_label()}
						description={m.staff_projects_what_work_live_room_refresh_body()}
					/>
					<Field field={fields.description} type="textarea" label={m.staff_description_label()} />
					<Field
						field={fields.templateId}
						type="select"
						label={m.staff_template_label()}
						placeholder={m.ui_none_placeholder()}
						options={templateOptions}
					/>
					<Field
						field={fields.groupId}
						type="select"
						label={m.staff_owning_committee_label()}
						placeholder={m.ui_none_placeholder()}
						options={committeeOptions}
						description={m.staff_projects_only_committee_can_own_project_body()}
					/>
					<MoneyField field={fields.budgetCents} label={m.staff_budget_label()} />
					<Field field={fields.startsAt} type="date" label={m.staff_starts_label()} />
					<Field field={fields.endsAt} type="date" label={m.staff_ends_label()} />
				{/snippet}
			</Action>
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
