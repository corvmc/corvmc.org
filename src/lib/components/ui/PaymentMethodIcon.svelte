<script lang="ts">
	import { IconCash, IconCoins } from '@tabler/icons-svelte';

	let {
		method,
		size = 16,
		class: className = ''
	}: {
		method: string;
		size?: number;
		class?: string;
	} = $props();
</script>

<span class="tooltip" data-tip={method}>
	{#if method === 'Credits'}
		<IconCoins {size} class={className} />
	{:else}
		<IconCash {size} class={className} />
	{/if}
</span>
