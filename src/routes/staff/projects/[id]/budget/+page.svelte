<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { getProjectDetail } from '$lib/remote/projects.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import BudgetReport from '../BudgetReport.svelte';

	// A report on the project, apart from the task list where its work is run.
	const data = $derived(await getProjectDetail(page.params.id!));
</script>

<PageHeader
	title="Budget"
	documentTitle="{data.project.name} budget"
	parent={{
		label: data.project.name,
		href: resolve(`/staff/projects/${data.project.id}`)
	}}
/>

<PageContent>
	<BudgetReport {data} />
</PageContent>
