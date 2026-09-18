<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getMemberCategories } from '$lib/remote/help.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import HelpSearch from '$lib/components/help/HelpSearch.svelte';
	import {
		IconBook,
		IconSettings,
		IconCalendar,
		IconUsers,
		IconUser,
		IconMusic,
		IconHelp,
		IconTicket,
		IconTool,
		IconLayout,
		IconPackage,
		IconHeart,
		IconHeartHandshake,
		IconMessage,
		IconBulb
	} from '@tabler/icons-svelte';

	let categories = $derived(await getMemberCategories());

	// Keys are the `icon` values seeded in scripts/seed-dev.ts. A category whose
	// icon is not here silently renders as IconBook, so half the help centre once
	// wore the same icon — keep the two lists in step.
	const iconMap: Record<string, typeof IconBook> = {
		book: IconBook,
		settings: IconSettings,
		calendar: IconCalendar,
		users: IconUsers,
		user: IconUser,
		music: IconMusic,
		help: IconHelp,
		ticket: IconTicket,
		tool: IconTool,
		layout: IconLayout,
		package: IconPackage,
		heart: IconHeart,
		'heart-handshake': IconHeartHandshake,
		message: IconMessage,
		bulb: IconBulb
	};

	function handleSelect(slug: string) {
		goto(resolve(`/member/help/${slug}`));
	}

	/** Enough to show what a category covers without the tallest card setting the row. */
	const ARTICLES_SHOWN = 5;
</script>

<!-- `3xl`, not `2xl`: 672px split into two columns is ~320px each, which
     wrapped every category name and description (#1045). -->
<PageHeader width="3xl" title="Help Center" subtitle="Support" />
<PageContent width="3xl">
	<HelpSearch onselect={handleSelect} />

	{#if categories.length === 0}
		<EmptyState message="No help articles available yet." />
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each categories as category (category.id)}
				{@const Icon = iconMap[category.icon ?? ''] ?? IconBook}
				<Card bordered>
					<CardBody padding="sm">
						<div class="flex items-start gap-3">
							<div class="rounded-lg bg-primary/10 p-2">
								<Icon size={20} class="text-primary" />
							</div>
							<div class="min-w-0 flex-1">
								<!-- The thing you navigate by, a size above the links under it:
								     at `text-sm font-semibold` over `text-sm` links, a
								     10-article card read as eleven near-identical lines. -->
								<h3 class="text-base font-semibold">{category.name}</h3>
								{#if category.description}
									<p class="mt-0.5 text-subtle">{category.description}</p>
								{/if}
							</div>
						</div>
						{#if category.articles.length > 0}
							<!-- Capped: nothing limited this, so a 12-article category sat
							     beside a 2-article one and the short card stretched to
							     leave a hole (#1045). -->
							<ul class="mt-3 space-y-1">
								{#each category.articles.slice(0, ARTICLES_SHOWN) as article (article.slug)}
									<li>
										<a
											href={resolve(`/member/help/${article.slug}`)}
											class="text-sm transition-colors hover:text-primary"
										>
											{article.title}
										</a>
									</li>
								{/each}
							</ul>
							{#if category.articles.length > ARTICLES_SHOWN}
								<!-- A count, not a link: there is no per-category page to go
								     to, and the search above is how the rest are found. -->
								<p class="mt-2 text-subtle text-sm">
									and {category.articles.length - ARTICLES_SHOWN} more
								</p>
							{/if}
						{:else}
							<p class="mt-3 text-subtle italic">No articles yet</p>
						{/if}
					</CardBody>
				</Card>
			{/each}
		</div>
	{/if}
</PageContent>
