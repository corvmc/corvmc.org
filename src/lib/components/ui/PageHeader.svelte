<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { setDefaultButtonSize } from '$lib/components/ui/Button.svelte';
	import Breadcrumbs from './Breadcrumbs.svelte';
	import { getBreadcrumbTrail, pageCrumbs, type Crumb } from './breadcrumbs';
	import { pageTitle } from '$lib/config';
	import { PAGE_WIDTH, type PageWidth } from './page-width';
	import { MediaQuery } from 'svelte/reactivity';
	import OverflowMenu from './OverflowMenu.svelte';

	let {
		title,
		subtitle,
		width = 'full',
		crumb,
		parent,
		documentTitle,
		flush = false,
		sticky = true,
		leading,
		primary,
		menu,
		menuLabel,
		children
	}: {
		/** The one action that stays on the row at every width, beside the ••• menu. */
		primary?: Snippet;
		/**
		 * Rows of the header's ••• menu. A header with a menu folds its `children`
		 * into it below `sm`, so a phone keeps the title, `primary` and •••.
		 */
		menu?: Snippet;
		/** Accessible name of the ••• trigger. */
		menuLabel?: string;
		title: string;
		/**
		 * Match the `PageContent` below. The header is full-bleed and sticky, so
		 * its row has to be constrained to the same column or the title floats
		 * left of everything it labels — 232px left of it at `2xl` (#1231).
		 */
		width?: PageWidth;
		/**
		 * This page's own crumb, after the trail the panel's nav implies.
		 * Defaults to `title`; set it when the title would make a poor crumb.
		 */
		crumb?: string;
		/**
		 * Crumbs between the nav's trail and this page, for a record the URL
		 * cannot place on its own — a production under its event. One the nav
		 * already shows is dropped.
		 */
		parent?: Crumb | Crumb[];
		children?: Snippet;
		subtitle?: string;
		/**
		 * Rendered beside the title. For a record whose
		 * identity is a picture as much as a name — a member's avatar — so the page
		 * does not have to restate the name below the header to get one on screen.
		 */
		leading?: Snippet;
		/**
		 * Overrides the browser tab title when the on-screen heading would make a
		 * poor one (too long, or missing context outside the page). Defaults to
		 * `title`; pass `null` to opt out and set `<title>` yourself.
		 */
		documentTitle?: string | null;
		/**
		 * Drop the gap below the header, for a page whose content runs to the edge
		 * of the frame rather than sitting in cards — the band page editor, whose
		 * canvas starts immediately under it.
		 */
		flush?: boolean;
		/** Off for a page whose own bar sticks instead, so the two do not stack. */
		sticky?: boolean;
	} = $props();

	// Header actions are one size, whatever each caller passes or omits (#1831).
	setDefaultButtonSize('sm');

	const resolvedTitle = $derived(documentTitle === undefined ? title : documentTitle);

	const trail = getBreadcrumbTrail();
	const parents = $derived(parent === undefined ? [] : Array.isArray(parent) ? parent : [parent]);
	const crumbs = $derived(pageCrumbs(trail?.current, parents, crumb ?? title));

	// Tailwind's `sm`. SSR renders the wide row and so does hydration, which must
	// match it; a phone folds once mounted.
	const wide = new MediaQuery('min-width: 40rem', true);
	let mounted = $state(false);
	onMount(() => (mounted = true));
	const folded = $derived(!!menu && mounted && !wide.current);
</script>

<!--
	Every panel page renders a PageHeader (ui-patterns.md requires it for the page
	title), so owning <title> here gives the whole authenticated app tab titles
	from one place. There is deliberately no fallback <title> in app.html or the
	root layout: duplicate <title> elements are not deduped, and the layout's head
	renders first, so a global fallback would win over every real title.
-->
<svelte:head>
	{#if resolvedTitle}
		<title>{pageTitle(resolvedTitle)}</title>
	{/if}
</svelte:head>

<div
	data-page-header
	class="{sticky ? 'sticky top-0 z-10' : ''} -mx-6 {flush
		? ''
		: 'mb-6'} border-b border-base-300 bg-base-100 px-6 py-3"
>
	<!--
		The whole row is constrained, not just the title: the bar itself stays
		full-bleed so its border and background still run edge to edge, while the
		title and the actions land on the same two edges as the content below.
	-->
	<div class="flex flex-wrap items-center justify-between gap-2 {PAGE_WIDTH[width]}">
		<!--
			The title column has a real minimum: with `min-w-0` alone it never
			forces a wrap, and four actions squeezed it to "Fo…" on a phone (#1910).
			`truncate` sits on a span because h1's unlayered `text-wrap` defeats it.
		-->
		<div class="flex min-w-[min(12rem,100%)] flex-1 flex-col">
			<Breadcrumbs {crumbs} />
			<div class="flex min-w-0 items-center gap-3">
				{#if leading}
					{@render leading()}
				{/if}
				<hgroup class="flex min-w-0 flex-col">
					<h1 class="text-2xl font-bold"><span class="block truncate">{title}</span></h1>
					{#if subtitle}
						<span class="text-sm font-bold text-primary uppercase">{subtitle}</span>
					{/if}
				</hgroup>
			</div>
		</div>
		<!--
			Actions are grouped rather than rendered as bare flex children: the
			header is `justify-between`, so two or more loose buttons get spread
			across its whole width instead of sitting together opposite the title.
		-->
		{#if children || primary || menu}
			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if !folded}
					{@render children?.()}
				{/if}
				{@render primary?.()}
				{#if menu}
					<OverflowMenu label={menuLabel}>
						{#if folded}
							{@render children?.()}
						{/if}
						{@render menu()}
					</OverflowMenu>
				{/if}
			</div>
		{/if}
	</div>
</div>
