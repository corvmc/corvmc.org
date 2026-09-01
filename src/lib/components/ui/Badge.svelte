<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	let {
		variant,
		size = 'sm',
		class: className = '',
		children,
		...rest
	}: {
		variant?:
			'outline' | 'ghost' | 'primary' | 'success' | 'error' | 'warning' | 'info' | 'secondary';
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
		children: Snippet;
		/** Forwarded to the `<span>` — `title`, `id`, `data-*`, aria attributes. */
		[key: string]: unknown;
	} = $props();

	const classes = $derived(
		clsx('badge', variant && `badge-${variant}`, size !== 'md' && `badge-${size}`, className)
	);
</script>

<span {...rest} class={classes}>
	{@render children()}
</span>
