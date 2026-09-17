<script lang="ts">
	import type { Snippet } from 'svelte';
	import { PAGE_WIDTH, type PageWidth } from './page-width';

	let {
		width = 'full',
		class: className = '',
		children
	}: {
		width?: PageWidth;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div class="@container flex-auto space-y-6 {PAGE_WIDTH[width]} {className}">
	{@render children()}
</div>
