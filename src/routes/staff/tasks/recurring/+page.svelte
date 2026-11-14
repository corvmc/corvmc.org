<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import RecurringWork from './RecurringWork.svelte';
</script>

<PageHeader title={m.staff_tasks_recurring_work_title()} />

<PageContent>
	<RecurringWork />
</PageContent>
