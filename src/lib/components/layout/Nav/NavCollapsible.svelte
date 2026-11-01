<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import NavStar from './NavStar.svelte';

	let {
		href,
		label,
		icon,
		badge,
		active,
		childHrefs,
		children,
		starred = false,
		onstar
	}: {
		/** `''` for a row with no in-app destination; rendered as no `href` at all. */
		href: ResolvedPathname | '';
		label: string;
		icon?: Snippet;
		/** Queue count on the parent row, same treatment as Nav.Item. */
		badge?: number;
		/** Overrides the built-in exact-pathname match; see Nav.Item. */
		active?: boolean;
		childHrefs: string[];
		children: Snippet;
		starred?: boolean;
		/** Present ⇒ the row carries a star toggle; see Nav.Item. */
		onstar?: () => void;
	} = $props();

	let isOpen = $derived(childHrefs.some((href) => page.url.pathname.startsWith(href)));
	let isActive = $derived(active ?? page.url.pathname === href);
	const labelId = $props.id();
</script>

<li class:relative={onstar}>
	<a href={href || undefined} class:active={isActive} class:pe-8={onstar}>
		{@render icon?.()}
		<span class="grow" id="{labelId}-label">{label}</span>
		{#if badge}
			<span class="badge badge-sm badge-primary">{badge > 99 ? '99+' : badge}</span>
		{/if}
	</a>
	{#if onstar}
		<NavStar {starred} describedby="{labelId}-label" ontoggle={onstar} />
	{/if}
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
