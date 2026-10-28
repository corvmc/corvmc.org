<script lang="ts">
	/**
	 * Recurring work sits beside Projects, not under Volunteering (#1796): it
	 * defines work and generates work orders, where Volunteering pairs existing
	 * work with people on the roster.
	 */
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import RecurringWork from './RecurringWork.svelte';
</script>

<PageHeader title="Recurring Work" subtitle="Staff" />

<PageContent>
	<p class="text-muted">
		Each one writes its next work order when the open one closes. The open occurrences are on the
		<a class="link" href={withQuery(resolve('/staff/volunteer/schedule'), 'kind=recurring')}
			>Schedule</a
		>.
	</p>
	<RecurringWork />
</PageContent>
