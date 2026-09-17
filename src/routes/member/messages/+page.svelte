<script lang="ts">
	/**
	 * The desktop right pane with nothing open. On a phone this route renders only
	 * the list — `InboxShell` hides this pane below `lg` — so it is never the whole
	 * screen, and does not need to be.
	 *
	 * A master/detail layout has three states, not two: an empty list, a list with
	 * nothing selected, and a record. "Pick a conversation on the left" beside a
	 * pane that says "No messages yet" was the first state rendering as the second
	 * (#1233), so this pane stands down and lets the list's own empty state be the
	 * page's single answer.
	 *
	 * The same query the list runs, at the same page: queries are cached per
	 * argument, so this is the list's own entry rather than a second request.
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
