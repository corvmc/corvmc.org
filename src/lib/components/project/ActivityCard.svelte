<script lang="ts">
	import type { RemoteQuery } from '@sveltejs/kit';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { errorMessage } from '$lib/error-message';
	import { retryQuery } from '$lib/utils/retry-query';
	import ActivityList, { type ActivityPage } from './ActivityList.svelte';

	/**
	 * A project's or a work order's history, loaded on its own beside the page's
	 * one load-bearing query. The `pending` snippet keeps it off the server
	 * render, which is the point: the page does not wait for it.
	 */
	let {
		query,
		projectId
	}: {
		/** The activity read; `limit` is left off for the first page so writes can refresh it. */
		query: (limit?: number) => RemoteQuery<ActivityPage>;
		/** Links an entry about one task to its page. Omitted on that task's own page. */
		projectId?: string;
	} = $props();

	let limit = $state<number | undefined>(undefined);
</script>

<InfoCard title="Activity">
	<svelte:boundary>
		<ActivityList {query} {limit} {projectId} onmore={(next) => (limit = next)} />

		{#snippet pending()}
			<div class="flex justify-center py-6">
				<span class="loading loading-sm loading-spinner"></span>
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<Alert type="warning" reset={() => retryQuery(query(limit), reset)}>
				Could not load the activity: {errorMessage(error)}
			</Alert>
		{/snippet}
	</svelte:boundary>
</InfoCard>
