<script lang="ts">
	import { getPreview } from '$lib/remote/marketing.remote';

	/**
	 * The live campaign preview, owning the query that renders it.
	 *
	 * `getPreview` re-fires as the body is typed, so it must not share a query with the campaign
	 * itself — the campaign would be re-fetched on every keystroke. On the page it was also a
	 * second remote query in flight, which is the shape that stops a page rendering past kit 2.64.
	 */
	let { markdown }: { markdown: string } = $props();

	const html = $derived(await getPreview(markdown));
</script>

<div class="overflow-hidden rounded-lg border bg-white" style="min-height: 400px;">
	{#if html}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (admin campaign HTML preview) -->
		{@html html}
	{:else}
		<div class="flex h-full items-center justify-center p-12 text-sm opacity-40">
			Start typing to see a preview...
		</div>
	{/if}
</div>
