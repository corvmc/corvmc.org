<script lang="ts">
	import SponsorSection from './SponsorSection.svelte';

	let { id }: { id: string } = $props();
</script>

<!-- The section awaits its sponsor query, which needs a boundary above it. -->
<svelte:boundary>
	<SponsorSection {id} />
	{#snippet pending()}{/snippet}
	{#snippet failed(error)}
		<p data-harness-failed>{String(error)}</p>
	{/snippet}
</svelte:boundary>
