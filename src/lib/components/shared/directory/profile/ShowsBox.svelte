<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import ProfileSection from './ProfileSection.svelte';
	import GigList from '$lib/components/shared/events/GigList.svelte';
	import type { CalendarEntry } from '$lib/types/calendar';

	let {
		upcoming,
		past,
		pastCount,
		pastHasMore = false,
		loadMorePast,
		eventBase,
		bandBase,
		showByline = true
	}: {
		upcoming: CalendarEntry[];
		/** First page of past shows, newest first. */
		past: CalendarEntry[];
		/** Total past shows, including pages not fetched yet. */
		pastCount: number;
		pastHasMore?: boolean;
		/** Fetches the next page of past shows. Omit to disable the pager. */
		loadMorePast?: (offset: number) => Promise<{ events: CalendarEntry[]; hasMore: boolean }>;
		/** Base path for event links — member routes pass '/member/events'. */
		eventBase?: string;
		/** Base path for band links in the byline. */
		bandBase?: string;
		/** Off on a band's own profile, where every row is that band. */
		showByline?: boolean;
	} = $props();

	let tab = $state<'upcoming' | 'past'>('upcoming');

	// Pages fetched by "Show more", appended to the server-rendered first page.
	let extra = $state<CalendarEntry[]>([]);
	let extraHasMore = $state<boolean | null>(null);
	let loading = $state(false);

	const pastRows = $derived([...past, ...extra]);
	const hasMore = $derived(extraHasMore ?? pastHasMore);

	async function showMore() {
		if (!loadMorePast) return;
		loading = true;
		try {
			const next = await loadMorePast(pastRows.length);
			extra = [...extra, ...next.events];
			extraHasMore = next.hasMore;
		} finally {
			loading = false;
		}
	}
</script>

<ProfileSection title="Shows">
	{#snippet actions()}
		<div class="seg">
			<button
				type="button"
				class="seg__opt"
				class:is-active={tab === 'upcoming'}
				onclick={() => (tab = 'upcoming')}
			>
				Upcoming
			</button>
			<button
				type="button"
				class="seg__opt"
				class:is-active={tab === 'past'}
				onclick={() => (tab = 'past')}
			>
				Past · {pastCount}
			</button>
		</div>
	{/snippet}

	{#if tab === 'upcoming'}
		{#if upcoming.length > 0}
			<GigList events={upcoming} {eventBase} {bandBase} {showByline} />
		{:else}
			<p class="shows__empty">No upcoming dates.</p>
		{/if}
	{:else if pastRows.length > 0}
		<GigList events={pastRows} {eventBase} {bandBase} {showByline} />
		{#if hasMore && loadMorePast}
			<div class="shows__more">
				<Button type="button" variant="ghost" size="sm" disabled={loading} onclick={showMore}>
					{loading ? 'Loading…' : 'Show more'}
				</Button>
			</div>
		{/if}
	{:else}
		<p class="shows__empty">No past shows yet.</p>
	{/if}
</ProfileSection>

<style>
	.seg {
		display: inline-flex;
		border: 1px solid color-mix(in oklch, var(--cmc-brown) 28%, transparent);
		border-radius: var(--radius-pill, 9999px);
		overflow: hidden;
	}
	.seg__opt {
		font-size: 11px;
		font-weight: 600;
		padding: 4px 11px;
		background: var(--bg-card);
		color: var(--fg-2);
		cursor: pointer;
		font-variant-numeric: tabular-nums;
	}
	.seg__opt.is-active {
		background: var(--color-secondary);
		color: var(--color-secondary-content);
	}
	.shows__empty {
		margin: 0;
		font-size: 13px;
		color: var(--fg-3);
	}
	.shows__more {
		margin-top: 12px;
		text-align: center;
	}
</style>
