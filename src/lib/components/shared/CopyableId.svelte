<script lang="ts">
	import Button from './Button.svelte';
	import { IconCopy } from '@tabler/icons-svelte';

	let {
		value,
		label = ''
	}: {
		value: string;
		label?: string;
	} = $props();

	const display = $derived(
		value.length > 16 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value
	);
</script>

<div>
	{#if label}
		<p class="text-xs opacity-50">{label}</p>
	{/if}
	<div class="mt-1 flex items-center gap-2">
		<code class="text-subtle">{display}</code>
		<Button
			variant="ghost"
			size="xs"
			onclick={() => navigator.clipboard.writeText(value)}
			title="Copy"
		>
			<IconCopy size={14} />
		</Button>
	</div>
</div>
