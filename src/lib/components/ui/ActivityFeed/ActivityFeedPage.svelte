<script lang="ts" generics="T, R extends ActivityRow">
	import type { Snippet } from 'svelte';
	import type { RemoteQuery } from '@sveltejs/kit';
	import type { ActivityRow, FeedPage } from './types';
	import ActivityFeed from './ActivityFeed.svelte';

	let {
		query,
		limit,
		toRow,
		onmore,
		empty,
		label,
		trailing
	}: {
		query: (limit?: number) => RemoteQuery<FeedPage<T>>;
		limit: number | undefined;
		toRow: (item: T) => R;
		onmore: () => void;
		empty: { title: string; description?: string };
		label?: string;
		trailing?: Snippet<[R]>;
	} = $props();

	const page = $derived(await query(limit));
</script>

<ActivityFeed
	rows={page.items.map(toRow)}
	hasMore={page.hasMore}
	{onmore}
	{empty}
	{label}
	{trailing}
/>
