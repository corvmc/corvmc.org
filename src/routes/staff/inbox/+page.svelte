<script lang="ts">
	/**
	 * The right pane with nothing open. Hidden below `lg`, where the queue itself
	 * is the whole screen.
	 *
	 * Silent when the queue is empty: "pick a conversation from the queue" beside
	 * a queue that says there is nothing in it is the empty-list state rendering
	 * as the nothing-selected state (#1233). The seed has seven threads, which is
	 * the only reason this read correctly.
	 *
	 * The same query the list runs, with the same filters: queries are cached per
	 * argument, so this is the list's own entry rather than a second request.
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
