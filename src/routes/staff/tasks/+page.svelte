<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import TaskCatalogue from '#lib/components/task/TaskCatalogue.svelte';
	import StaffViews from '../StaffViews.svelte';
	import { taskViews } from './views';
	import TaskSettings from './TaskSettings.svelte';
</script>

<PageHeader title={m.staff_tasks_title()}>
	<StaffViews views={taskViews} active="tasks" collapse />
	<TaskSettings />
</PageHeader>

<PageContent>
	<TaskCatalogue />
</PageContent>
