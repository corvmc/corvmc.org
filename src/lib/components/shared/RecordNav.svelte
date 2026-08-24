<script lang="ts">
	import { IconArrowLeft, IconArrowRight } from '@tabler/icons-svelte';
	import Button from '$lib/components/shared/Button.svelte';

	let {
		prevHref,
		nextHref,
		endLabel = ''
	}: {
		prevHref?: string;
		nextHref?: string;
		endLabel?: string;
	} = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (e.key === 'ArrowLeft' && prevHref) {
			window.location.href = prevHref;
		} else if (e.key === 'ArrowRight' && nextHref) {
			window.location.href = nextHref;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex items-center gap-4">
	{#if prevHref}
		<Button href={prevHref} variant="ghost" size="sm" title="Previous (←)">
			<IconArrowLeft size={16} />
			Prev
		</Button>
	{:else}
		<Button disabled variant="ghost" size="sm">
			<IconArrowLeft size={16} />
			Prev
		</Button>
	{/if}

	{#if nextHref}
		<Button href={nextHref} variant="ghost" size="sm" title="Next (→)">
			Next
			<IconArrowRight size={16} />
		</Button>
	{:else if endLabel}
		<span class="text-xs opacity-50">{endLabel}</span>
	{:else}
		<Button disabled variant="ghost" size="sm">
			Next
			<IconArrowRight size={16} />
		</Button>
	{/if}
</div>
