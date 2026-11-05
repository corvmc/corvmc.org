<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import ScheduleViews from '../ScheduleViews.svelte';
	import RecurringWork from './RecurringWork.svelte';
</script>

<PageHeader title={m.staff_schedule()} subtitle={m.staff_planning()}>
	<ScheduleViews active="recurring" />
</PageHeader>

<PageContent>
	<RecurringWork />
</PageContent>
