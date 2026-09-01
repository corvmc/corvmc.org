<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		message = 'No items found.',
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

<div class="py-12 text-center opacity-60 {className}">
	{#if children}
		{@render children()}
	{:else}
		{#if title}
			<p class="font-semibold">{title}</p>
		{/if}
		<p>{displayMessage}</p>
		{#if actionLabel && actionHref}
			<a href={actionHref} class="mt-2 inline-block link link-primary">{actionLabel}</a>
		{/if}
	{/if}
</div>
