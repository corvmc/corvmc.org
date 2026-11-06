<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getMemberArticlePage } from '#lib/remote/help.remote.js';
	import { extractHeadings } from '#lib/utils/markdown.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import MarkdownPreview from '#lib/components/help/MarkdownPreview.svelte';
	import TableOfContents from '#lib/components/help/TableOfContents.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug');

	let slug = $derived(params.slug);
	const data = $derived(await getMemberArticlePage(slug));
	const article = $derived(data.article);
	const categories = $derived(data.categories);

	let headings = $derived(extractHeadings(article.content));
	let category = $derived(categories.find((c) => c.id === article.categoryId));
</script>

<PageHeader
	width="3xl"
	title={article.title}
	subtitle={m.member_help_center()}
	parent={category ? [{ label: category.name }] : []}
/>
<PageContent width="3xl">
	<div class="flex gap-8">
		<article class="min-w-0 flex-1">
			{#if article.summary}
				<p class="mb-6 text-sm text-base-content/70">{article.summary}</p>
			{/if}
			<MarkdownPreview content={article.content} />
		</article>

		{#if headings.length > 2}
			<aside class="toc-rail hidden shrink-0 lg:block">
				<TableOfContents {headings} />
			</aside>
		{/if}
	</div>
</PageContent>
