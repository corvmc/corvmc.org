<script lang="ts">
	/**
	 * The right pane with nothing open. Hidden below `lg`, where the queue itself
	 * is the whole screen.
	 */
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
</script>

<div class="flex h-full items-center justify-center">
	<EmptyState
		title="No conversation selected"
		description="Pick a conversation from the queue to read and reply."
	/>
</div>
