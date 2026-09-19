<script lang="ts">
	/**
	 * The group's topics. One page rather than a pane: a club's panel has no
	 * inbox shell, so picking a topic is a navigation and the topic page has a
	 * back link to here (#1301).
	 */
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import GroupTopicList from '$lib/components/inbox/GroupTopicList.svelte';

	const slug = $derived(page.params.slug!);
</script>

<PageHeader width="2xl" title="Chat" backHref="/member/groups/{slug}" />
<PageContent width="2xl">
	<GroupTopicList
		{slug}
		hrefFor={(threadId) => `/member/groups/${slug}/chat/${threadId}`}
		openThreadId={null}
	/>
</PageContent>
