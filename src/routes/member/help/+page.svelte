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
</script>

<PageHeader title="Help Center" subtitle="Support" />
<PageContent width="2xl">
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
								<h3 class="text-sm font-semibold">{category.name}</h3>
								{#if category.description}
									<p class="mt-0.5 text-subtle">{category.description}</p>
								{/if}
							</div>
						</div>
						{#if category.articles.length > 0}
							<ul class="mt-3 space-y-1">
								{#each category.articles as article (article.slug)}
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
						{:else}
							<p class="mt-3 text-xs italic opacity-50">No articles yet</p>
						{/if}
					</CardBody>
				</Card>
			{/each}
		</div>
	{/if}
</PageContent>
