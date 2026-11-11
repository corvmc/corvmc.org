<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { getProjectDetail } from '#lib/remote/projects.remote.js';
	import { resolve } from '$app/paths';
	import BudgetReport from '../BudgetReport.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	// A report on the project, apart from the task list where its work is run.
	const data = $derived(await getProjectDetail(params.id));
</script>

<PageHeader
	title={m.staff_budget_title()}
	documentTitle={m.staff_projects_id_budget_document_title({ name: data.project.name })}
	parent={{
		label: data.project.name,
		href: resolve(`staff/projects/${data.project.id}`)
	}}
/>

<PageContent>
	<BudgetReport {data} />
</PageContent>
