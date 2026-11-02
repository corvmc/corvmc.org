<script lang="ts" generics="T extends FeedItem, R extends ActivityRow">
	import type { Snippet } from 'svelte';
	import type { RemoteQuery } from '@sveltejs/kit';
	import InfoCard from '../InfoCard.svelte';
	import Alert from '../Alert.svelte';
	import { errorMessage } from '$lib/error-message';
	import { FEED_PAGE } from '$lib/types/activity';
	import { retryQuery } from '$lib/utils/retry-query';
	import type { ActivityRow, FeedItem, FeedPage } from './types';
	import ActivityFeedPage from './ActivityFeedPage.svelte';

	/**
	 * A history card loaded on its own beside the page's one load-bearing query.
	 * The `pending` snippet keeps it off the server render, which is the point:
	 * the page does not wait for it. The first page is read with no `limit`, so
	 * a write can refresh it; "Show older" asks for a longer page.
	 */
	let {
		title = 'Activity',
		query,
		toRow,
		empty,
		trailing,
		class: className = ''
	}: {
		title?: string;
		query: (limit?: number) => RemoteQuery<FeedPage<T>>;
		toRow: (item: T) => R;
		empty: { title: string; description?: string };
		trailing?: Snippet<[R]>;
		class?: string;
	} = $props();

	let limit = $state<number | undefined>(undefined);
</script>

<InfoCard {title} class={className}>
	<svelte:boundary>
		<ActivityFeedPage
			{query}
			{limit}
			{toRow}
			{empty}
			{trailing}
			label={title}
			onmore={() => (limit = (limit ?? FEED_PAGE) + FEED_PAGE)}
		/>

		{#snippet pending()}
			<div class="flex justify-center py-6">
				<span class="loading loading-sm loading-spinner"></span>
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<Alert type="warning" reset={() => retryQuery(query(limit), reset)}>
				Could not load the {title.toLowerCase()}: {errorMessage(error)}
			</Alert>
		{/snippet}
	</svelte:boundary>
</InfoCard>
