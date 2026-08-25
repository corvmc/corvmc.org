<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	let {
		variant,
		size = 'sm',
		class: className = '',
		children
	}: {
		variant?:
			'outline' | 'ghost' | 'primary' | 'success' | 'error' | 'warning' | 'info' | 'secondary';
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
		children: Snippet;
	} = $props();

	const classes = $derived(
		clsx('badge', variant && `badge-${variant}`, size !== 'md' && `badge-${size}`, className)
	);
</script>

<span class={classes}>
	{@render children()}
</span>
