<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getMemberArticle, getMemberCategories } from '$lib/remote/help.remote';
	import { extractHeadings } from '$lib/utils/markdown';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import MarkdownPreview from '$lib/components/help/MarkdownPreview.svelte';
	import TableOfContents from '$lib/components/help/TableOfContents.svelte';

	let slug = $derived(page.params.slug!);
	let article = $derived(await getMemberArticle(slug));
	let categories = $derived(await getMemberCategories());

	let headings = $derived(extractHeadings(article.content));
	let category = $derived(categories.find((c) => c.id === article.categoryId));
</script>

<PageHeader title={article.title} subtitle="Help Center" backHref="/member/help" />
<PageContent width="3xl">
	<div class="breadcrumbs mb-4 text-sm">
		<ul>
			<li><a href={resolve('/member/help')}>Help</a></li>
			{#if category}
				<li>{category.name}</li>
			{/if}
			<li>{article.title}</li>
		</ul>
	</div>

	<div class="flex gap-8">
		<article class="min-w-0 flex-1">
			{#if article.summary}
				<p class="mb-6 text-sm text-base-content/70">{article.summary}</p>
			{/if}
			<MarkdownPreview content={article.content} />
		</article>

		{#if headings.length > 2}
			<aside class="sticky top-20 hidden w-48 shrink-0 self-start lg:block">
				<TableOfContents {headings} />
			</aside>
		{/if}
	</div>
</PageContent>
