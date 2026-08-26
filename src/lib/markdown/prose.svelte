<script>
	/** @type {string} */
	export let title = '';
	/** @type {string} */
	export let description = '';
</script>

<svelte:head>
	<title>{title} — CorvMC</title>
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
