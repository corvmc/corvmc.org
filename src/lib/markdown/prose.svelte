<script>
	import { m } from '#lib/paraglide/messages.js';
	/** @type {string} */
	export let title = '';
	/** @type {string} */
	export let description = '';
	// Read `m` here, not in the template: this file compiles in legacy mode, where a
	// template read of `m` deep-reads the namespace and bundles every message.
	const pageTitle = (/** @type {string} */ t) => m.layout_page_title({ title: t });
</script>

<svelte:head>
	<title>{pageTitle(title)}</title>
	{#if description}
		<meta name="description" content={description} />
	{/if}
</svelte:head>

<article
	class="mx-auto prose prose-lg max-w-3xl px-4 py-12"
	style="--tw-prose-links: var(--cmc-teal); --tw-prose-bullets: var(--cmc-orange); --tw-prose-counters: var(--cmc-orange); --tw-prose-hr: var(--surface-border);"
>
	<slot />
</article>
