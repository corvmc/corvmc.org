<script lang="ts">
	import { IconArrowLeft, IconArrowRight } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let {
		prevHref,
		nextHref,
		endLabel = ''
	}: {
		prevHref?: string;
		nextHref?: string;
		endLabel?: string;
	} = $props();

	// No arrow-key shortcut. This used to bind ArrowLeft/ArrowRight on the window
	// behind an is-the-user-typing guard, which only recognised inputs and
	// textareas — so an arrow pressed on a button, a select, or inside an open
	// modal navigated the whole page away (via `window.location`, discarding it
	// outright). Arrows belong to whatever has focus, and every chord that would
	// have replaced them is already browser history.
</script>

<div class="flex items-center gap-4">
	{#if prevHref}
		<Button href={prevHref} variant="ghost" size="sm" title="Previous">
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
		<Button href={nextHref} variant="ghost" size="sm" title="Next">
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
