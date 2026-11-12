<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StaffViews from '../../StaffViews.svelte';
	import { taskViews } from '../views';
	import RecurringWork from './RecurringWork.svelte';
</script>

<PageHeader title={m.staff_tasks_title()}>
	<StaffViews views={taskViews} active="recurring" collapse />
</PageHeader>

<PageContent>
	<RecurringWork />
</PageContent>
