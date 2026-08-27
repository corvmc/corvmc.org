<script lang="ts">
	import { resolve } from '$app/paths';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { getMyListings } from '$lib/remote/community-events.remote';

	/**
	 * The member's own community listings, owning the query behind them.
	 *
	 * Here rather than in the page's load-bearing query because `getMyListings` lives in
	 * `community-events.remote.ts` with the six mutations that refresh it, and composing it into a
	 * wrapper in `events.remote.ts` would have made those two files import each other. Owning it
	 * here leaves every one of those refreshes working untouched and the page holding one query.
	 */
	const mine = $derived(await getMyListings());
</script>

<section>
	<SectionLabel label="Your listings" count={mine.listings.length + mine.rejected.length} />

	{#if mine.standing.status !== 'none'}
		<Alert type="info" class="mb-4">
			Staff check your listings before they go on the public calendar.
		</Alert>
	{/if}

	{#if mine.listings.length === 0 && mine.rejected.length === 0}
		<EmptyState
			title="You haven't added any shows"
			description="Know about a gig around town? Put it on the calendar so the rest of the scene finds out."
			actionLabel="Add a show"
			actionHref={resolve('/member/events/submit')}
		/>
	{:else}
		<ul class="mlist">
			<!-- Returned listings lead: they're the ones waiting on the member. -->
			{#each [...mine.rejected, ...mine.listings] as row (row.id)}
				<li>
					<a href={resolve(`/member/events/${row.id}/manage`)} class="mlist__row">
						<StatusBadge status={row.status} />
						<span class="mlist__title">{row.title}</span>
						<span class="mlist__meta">
							{formatDateShort(row.startsAt)}{row.location ? ` \u00b7 ${row.location}` : ''}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.mlist {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.mlist__row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--surface-border);
		border-radius: 6px;
		text-decoration: none;
		color: inherit;
	}
	.mlist__row:hover {
		border-color: var(--cmc-orange);
	}
	.mlist__title {
		font-weight: 500;
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mlist__meta {
		font-size: 0.8rem;
		color: var(--fg-2);
		white-space: nowrap;
	}
</style>
