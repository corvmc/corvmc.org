<script lang="ts">
	import NewWorkOrderAction from './NewWorkOrderAction.svelte';
</script>

<!-- The action awaits its role query, which needs a boundary above it. -->
<svelte:boundary>
	<NewWorkOrderAction />
	{#snippet pending()}{/snippet}
	{#snippet failed(error)}
		<p data-harness-failed>{String(error)}</p>
	{/snippet}
</svelte:boundary>
