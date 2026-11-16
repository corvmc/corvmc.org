<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Alert from '#lib/components/ui/Alert.svelte';
	import AppealPanel from '#lib/components/moderation/AppealPanel.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { getMyListings } from '#lib/remote/community-events.remote.js';

	/**
	 * The member's own community listings, owning the query behind them.
	 *
	 * Here rather than in the page's load-bearing query because `getMyListings` lives in
	 * `community-events.remote.ts` with the six mutations that refresh it, and composing it into a
	 * wrapper in `events.remote.ts` would have made those two files import each other. Owning it
	 * here leaves every one of those refreshes working untouched and the page holding one query.
	 */
	const mine = $derived(await getMyListings());

	type Row = {
		id: string;
		title: string;
		status: string;
		startsAt: Date;
		location: string | null;
		band?: { name: string; slug: string };
	};
	// The member's own listings and their bands' events as one list by date (#3132);
	// returned listings still lead, since they wait on the member.
	const rows: Row[] = $derived([
		...mine.rejected,
		...[...mine.listings, ...mine.bandEvents].toSorted(
			(a, b) => a.startsAt.getTime() - b.startsAt.getTime()
		)
	]);

	function hrefOf(row: Row) {
		return row.band
			? resolve('/band/[slug]/events/[eventId]', { slug: row.band.slug, eventId: row.id })
			: resolve('/member/events/[id]/manage', { id: row.id });
	}
</script>

<section>
	<SectionLabel label={m.member_events_my_listings_section_label()} count={rows.length} />

	{#if mine.standing.status !== 'none'}
		<Alert type="info" class="mb-4">
			<p>{m.member_events_my_listings_section_staff_check_listings_befor_text()}</p>
			<AppealPanel target={{ kind: 'standing', scope: 'community_event' }} />
		</Alert>
	{/if}

	{#if rows.length === 0}
		<EmptyState
			title={m.member_events_my_listings_section_title()}
			description={m.member_events_my_listings_section_description_body()}
		/>
	{:else}
		<ul class="mlist">
			{#each rows as row (row.id)}
				<li>
					<a href={hrefOf(row)} class="mlist__row" data-band-event={row.band ? '' : undefined}>
						<StatusBadge status={row.status} />
						<span class="mlist__title">{row.title}</span>
						{#if row.band}
							<span class="badge badge-sm">{row.band.name}</span>
						{/if}
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
