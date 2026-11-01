<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import NavStar from './NavStar.svelte';

	let {
		href,
		externalHref,
		label,
		icon,
		badge,
		active,
		starred = false,
		onstar,
		...rest
	}: {
		/** `''` for a row with no in-app destination; rendered as no `href` at all. */
		href: ResolvedPathname | '';
		/**
		 * An off-site destination — a band's own live site on its custom domain.
		 * Rendered instead of `href`, with `rel="external"` so the router hands
		 * it to the browser rather than trying to route it. Kept separate from
		 * `href` rather than widening that to `string`: a row that leaves the app
		 * is a different thing from a row that navigates within it, and the type
		 * is what keeps every in-app row a real, checked route.
		 */
		externalHref?: string;
		label: string;
		icon?: Snippet;
		badge?: number;
		/**
		 * Overrides the built-in exact-pathname match. Panels that resolve their
		 * own active row — the staff sidebar matches on longest href, so detail
		 * pages still light a row — pass it; everyone else leaves it off.
		 */
		active?: boolean;
		starred?: boolean;
		/** Present ⇒ the row carries a star toggle. */
		onstar?: () => void;
		[key: string]: unknown;
	} = $props();

	let isActive = $derived(active ?? page.url.pathname === href);
	const labelId = $props.id();
</script>

<li class:relative={onstar}>
	{#if externalHref}
		<!-- `noopener` alongside `external`: this branch is reached with
		     `target="_blank"`, and without it the opened page can reach back
		     through `window.opener`. `external` is what tells the router to hand
		     the URL to the browser rather than try to match it as a route. -->
		<a
			href={externalHref}
			rel="external noopener"
			class:active={isActive}
			class:pe-8={onstar}
			{...rest}
		>
			{@render icon?.()}
			<span class="grow" id="{labelId}-label">{label}</span>
			{#if badge}
				<span class="badge badge-sm badge-primary">{badge > 99 ? '99+' : badge}</span>
			{/if}
		</a>
	{:else}
		<a href={href || undefined} class:active={isActive} class:pe-8={onstar} {...rest}>
			{@render icon?.()}
			<span class="grow" id="{labelId}-label">{label}</span>
			{#if badge}
				<span class="badge badge-sm badge-primary">{badge > 99 ? '99+' : badge}</span>
			{/if}
		</a>
	{/if}
	{#if onstar}
		<NavStar {starred} describedby="{labelId}-label" ontoggle={onstar} />
	{/if}
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
