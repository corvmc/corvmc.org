<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The grid every group of `StatCard`s sits in. It is two-up at phone width,
	 * never one-up, so figures stay comparable; `cols` is the count once the
	 * page is wide. `scripts/stat-grid.spec.ts` fails on a `StatCard` in any
	 * other grid.
	 */
	let {
		cols,
		class: className = '',
		children
	}: {
		cols: 2 | 3 | 4 | 5 | 7;
		class?: string;
		children: Snippet;
	} = $props();

	// Literal strings, so Tailwind's scanner sees every class.
	const COLS = {
		2: 'grid-cols-2',
		3: 'grid-cols-2 lg:grid-cols-3',
		4: 'grid-cols-2 lg:grid-cols-4',
		5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
		7: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-7'
	} as const;
</script>

<div class="grid gap-3 {COLS[cols]} {className}">
	{@render children()}
</div>
