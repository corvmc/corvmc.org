<script lang="ts">
	/**
	 * The desktop right pane with nothing open. On a phone this route renders only
	 * the list — `InboxShell` hides this pane below `lg` — so it is never the whole
	 * screen, and does not need to be.
	 */
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
</script>

<div class="flex h-full items-center justify-center">
	<EmptyState
		title="No conversation selected"
		description="Pick a conversation on the left, or start a new one."
	/>
</div>
