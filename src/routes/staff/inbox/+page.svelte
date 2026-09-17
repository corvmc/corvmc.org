<script lang="ts">
	/**
	 * The right pane with nothing open, hidden below `lg`. Silent when the queue
	 * is empty: "pick a conversation from the queue" beside a queue saying there
	 * is nothing in it is the empty-list state rendering as the nothing-selected
	 * one (#1233). The list's own query, same filters — queries are cached per
	 * argument, so this is its entry, not a second read.
	 */
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getInboxThreads } from '$lib/remote/inbox.remote';
	import { toQuery } from './filters.svelte';

	const result = $derived(getInboxThreads(toQuery()));
</script>

{#await result then { rows }}
	{#if rows.length > 0}
		<div class="flex h-full items-center justify-center">
			<EmptyState
				title="No conversation selected"
				description="Pick a conversation from the queue to read and reply."
			/>
		</div>
	{/if}
{/await}
