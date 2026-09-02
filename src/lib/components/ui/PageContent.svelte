<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		width = 'full',
		class: className = '',
		children
	}: {
		width?: 'full' | 'md' | '2xl' | '3xl' | '5xl';
		class?: string;
		children: Snippet;
	} = $props();

	const widthClass: Record<string, string> = {
		full: '',
		md: 'max-w-md mx-auto',
		'2xl': 'max-w-2xl mx-auto',
		'3xl': 'max-w-3xl mx-auto',
		// A single column of cards that still has to hold a table. Wider than 3xl
		// reads as a page with a hole in it; narrower makes the rows wrap.
		'5xl': 'max-w-5xl mx-auto'
	};
</script>

<div class="@container flex-auto space-y-6 {widthClass[width]} {className}">
	{@render children()}
</div>
