<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	/**
	 * The padded interior of a `Card`.
	 *
	 * `row` is here because the same three-class incantation
	 * (`flex-row items-center justify-between`) appeared eleven times to build
	 * one shape: a label on the left, a control on the right. daisyUI's
	 * `card-body` is a column, so every one of those had to override it by hand.
	 */
	let {
		padding = 'md',
		row = false,
		center = false,
		class: className = '',
		children
	}: {
		/** `'sm'` tightens `card-body`'s default padding for dense list rows. */
		padding?: 'sm' | 'md';
		/** Lay the body out as a label/control row rather than a column. */
		row?: boolean;
		/** Centre the contents — empty states, single-stat cards. */
		center?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div
	class={clsx(
		'card-body',
		padding === 'sm' && 'p-4',
		row && 'flex-row items-center justify-between',
		center && 'items-center text-center',
		className
	)}
>
	{@render children()}
</div>
