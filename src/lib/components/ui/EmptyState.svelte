<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		message,
		actionLabel,
		actionHref,
		class: className = '',
		children
	}: {
		title?: string;
		description?: string;
		message?: string;
		actionLabel?: string;
		actionHref?: ResolvedPathname;
		class?: string;
		children?: Snippet;
	} = $props();

	const displayMessage = $derived(description ?? message);
</script>

<!-- data-empty-state is the specs' hook; no role, since status would announce every empty filter. -->
<div class="py-12 text-center {className}" data-empty-state>
	{#if children}
		{@render children()}
	{:else}
		{#if title}
			<p class="font-semibold opacity-60">{title}</p>
		{/if}
		{#if displayMessage}
			<p class="opacity-60">{displayMessage}</p>
		{/if}
		{#if actionLabel && actionHref}
			<a href={actionHref} class="mt-2 inline-block link link-primary">{actionLabel}</a>
		{/if}
	{/if}
</div>
