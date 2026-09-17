<script lang="ts">
	/**
	 * The desktop right pane with nothing open, hidden below `lg`. Silent when
	 * the list is empty: a master/detail layout has three states, and "Pick a
	 * conversation on the left" beside "No messages yet" was the first rendering
	 * as the second (#1233). The list's own query at the same page — queries are
	 * cached per argument, so this is its entry, not a second read.
	 */
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getMyMessages } from '$lib/remote/direct-messages.remote';
	import { conversationList } from './list-state.svelte';

	const result = $derived(getMyMessages({ page: conversationList.page }));
</script>

{#await result then { rows }}
	{#if rows.length > 0}
		<div class="flex h-full items-center justify-center">
			<EmptyState title="No conversation selected" description="Pick a conversation on the left." />
		</div>
	{/if}
{/await}
