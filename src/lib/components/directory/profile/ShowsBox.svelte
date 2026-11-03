<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import ProfileSection from './ProfileSection.svelte';
	import GigList from '#lib/components/events/GigList.svelte';
	import type { CalendarEntry } from '#lib/types/calendar.js';

	let {
		upcoming,
		past,
		pastCount,
		pastHasMore = false,
		loadMorePast,
		eventBase
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
		eventBase?: '/events' | '/member/events';
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

<ProfileSection title={m.directory_profile_shows_box_title()}>
	{#snippet actions()}
		<div class="seg">
			<button
				type="button"
				class="seg__opt"
				class:is-active={tab === 'upcoming'}
				onclick={() => (tab = 'upcoming')}
			>
				{m.directory_profile_shows_box_upcoming()}
			</button>
			<button
				type="button"
				class="seg__opt"
				class:is-active={tab === 'past'}
				onclick={() => (tab = 'past')}
			>
				{m.directory_profile_shows_box_past({ pastCount })}
			</button>
		</div>
	{/snippet}

	{#if tab === 'upcoming'}
		{#if upcoming.length > 0}
			<GigList events={upcoming} {eventBase} />
		{:else}
			<p class="shows__empty">{m.directory_profile_shows_box_no_upcoming_dates()}</p>
		{/if}
	{:else if pastRows.length > 0}
		<GigList events={pastRows} {eventBase} />
		{#if hasMore && loadMorePast}
			<div class="shows__more">
				<Button type="button" variant="ghost" size="sm" disabled={loading} onclick={showMore}>
					{loading
						? m.directory_profile_shows_box_loading()
						: m.directory_profile_shows_box_show_more()}
				</Button>
			</div>
		{/if}
	{:else}
		<p class="shows__empty">{m.directory_profile_shows_box_no_past_shows_yet()}</p>
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
