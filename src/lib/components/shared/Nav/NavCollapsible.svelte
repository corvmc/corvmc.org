<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	let {
		href,
		label,
		icon,
		badge,
		active,
		childHrefs,
		children
	}: {
		href: string;
		label: string;
		icon?: Snippet;
		/** Queue count on the parent row, same treatment as Nav.Item. */
		badge?: number;
		/** Overrides the built-in exact-pathname match; see Nav.Item. */
		active?: boolean;
		childHrefs: string[];
		children: Snippet;
	} = $props();

	let isOpen = $derived(childHrefs.some((href) => page.url.pathname.startsWith(href)));
	let isActive = $derived(active ?? page.url.pathname === href);
</script>

<li>
	<a {href} class:active={isActive}>
		{@render icon?.()}
		<span class="grow">{label}</span>
		{#if badge}
			<span class="badge badge-primary badge-sm">{badge > 99 ? '99+' : badge}</span>
		{/if}
	</a>
	{#if isOpen}
		<ul class="menu-dropdown menu-dropdown-show">
			{@render children()}
		</ul>
	{/if}
</li>

<style>
	a :global(svg) {
		width: 20px;
		height: 20px;
	}

	a.active {
		background: oklch(from var(--color-primary) l c h / 30%);
	}
</style>
