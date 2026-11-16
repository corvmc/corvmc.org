<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The right pane with nothing open, hidden below `lg`. Silent when the queue
	 * is empty: "pick a conversation from the queue" beside a queue saying there
	 * is nothing in it is the empty-list state rendering as the nothing-selected
	 * one (#1233). The list's own query, same filters — queries are cached per
	 * argument, so this is its entry, not a second read.
	 */
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { getInboxThreads } from '#lib/remote/inbox.remote.js';
	import { toQuery } from './filters.svelte';
	import FirstReplyTimes from './FirstReplyTimes.svelte';

	const result = $derived(getInboxThreads(toQuery()));
</script>

<div class="flex h-full flex-col items-center justify-center gap-8">
	{#await result then { rows }}
		{#if rows.length > 0}
			<EmptyState title={m.staff_inbox_title()} description={m.staff_inbox_description_body()} />
		{/if}
	{:catch}
		<!-- The list beside this pane reports its own failure. -->
	{/await}

	<svelte:boundary>
		<FirstReplyTimes />
		{#snippet failed()}{/snippet}
	</svelte:boundary>
</div>
