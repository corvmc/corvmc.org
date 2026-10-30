<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import ScheduleViews from '../ScheduleViews.svelte';
	import RecurringWork from './RecurringWork.svelte';
</script>

<PageHeader title="Schedule" subtitle="Planning" />

<PageContent>
	<ScheduleViews active="recurring" />
	<RecurringWork />
</PageContent>
