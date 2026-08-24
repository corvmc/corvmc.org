<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	let {
		href,
		label,
		icon,
		badge,
		active,
		...rest
	}: {
		href: string;
		label: string;
		icon?: Snippet;
		badge?: number;
		/**
		 * Overrides the built-in exact-pathname match. Panels that resolve their
		 * own active row — the staff sidebar matches on longest href, so detail
		 * pages still light a row — pass it; everyone else leaves it off.
		 */
		active?: boolean;
		[key: string]: unknown;
	} = $props();

	let isActive = $derived(active ?? page.url.pathname === href);
</script>

<li>
	<a {href} class:active={isActive} {...rest}>
		{@render icon?.()}
		<span class="grow">{label}</span>
		{#if badge}
			<span class="badge badge-primary badge-sm">{badge > 99 ? '99+' : badge}</span>
		{/if}
	</a>
</li>

<style lang="postcss">
	a :global(svg) {
		width: 20px;
		height: 20px;
	}

	a.active {
		background: oklch(from var(--color-primary) l c h / 30%);
	}
</style>
