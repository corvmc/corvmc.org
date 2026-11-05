<script lang="ts">
	import { renderMarkdown } from '#lib/utils/markdown.js';

	let { content }: { content: string } = $props();

	let html = $derived(renderMarkdown(content));
</script>

<div class="prose prose-sm max-w-none">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (markdown render) -->
	{@html html}
</div>
