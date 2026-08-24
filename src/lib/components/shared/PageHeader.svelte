<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { pageTitle } from '$lib/config';

	let {
		title,
		subtitle,
		backHref,
		documentTitle,
		leading,
		children
	}: {
		title: string;
		backHref?: string;
		children?: Snippet;
		subtitle?: string;
		/**
		 * Rendered between the back button and the title. For a record whose
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
	} = $props();

	const resolvedTitle = $derived(documentTitle === undefined ? title : documentTitle);
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
	class="sticky top-0 z-10 -mx-6 flex flex-wrap items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-6 py-3 mb-6"
>
	<div class="flex min-w-0 items-center gap-3">
		{#if backHref}
			<Button href={backHref} variant="ghost" size="lg" shape="square">←</Button>
		{/if}
		{#if leading}
			{@render leading()}
		{/if}
		<hgroup class="flex min-w-0 flex-col">
			<h1 class="truncate text-2xl font-bold">{title}</h1>
			{#if subtitle}
				<span class="text-sm font-bold text-primary uppercase">{subtitle}</span>
			{/if}
		</hgroup>
	</div>
	<!--
		Actions are grouped rather than rendered as bare flex children: the header
		is `justify-between`, so two or more loose buttons get spread across its
		whole width instead of sitting together opposite the title.
	-->
	{#if children}
		<div class="flex flex-wrap items-center justify-end gap-2">
			{@render children()}
		</div>
	{/if}
</div>
