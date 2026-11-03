<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getUserBands } from '$lib/remote/bands.remote';
	import { getUserShows, getUserTicketsAndRsvps } from '$lib/remote/events.remote';
	import { getUserListings } from '$lib/remote/community-events.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '$lib/utils/format';

	let { id }: { id: string } = $props();
</script>

<!--
	Bands is the reason this panel exists. The relationship was only ever
	traversable band → members, so a staff member holding a name had no way to
	reach the bands behind it.
-->
<RelatedList title={m.staff_members_id_panels_bands_panel_bands()} result={getUserBands(id)}>
	{#snippet children(bands)}
		{#if bands.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_bands_panel_not_any_bands()}
				description={m.staff_members_id_panels_bands_panel_no_band_membership_invit()}
			/>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each bands as b (b.id)}
					<li class="rounded-box px-2 py-2 hover:bg-base-200">
						<!-- The square avatar is the registry's, not this list's. -->
						<EntityIdentity ref={b.ref} size="md">
							{#snippet meta()}
								<StatusBadge status={b.role} label />
								{#if b.status !== 'active'}
									<Badge variant="warning" size="sm"
										>{m.staff_members_id_panels_bands_panel_invite_pending()}</Badge
									>
								{/if}
							{/snippet}
						</EntityIdentity>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList title={m.staff_members_id_panels_bands_panel_shows_played()} result={getUserShows(id)}>
	{#snippet children(shows)}
		{#if shows.upcoming.length === 0 && shows.past.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_bands_panel_no_shows()}
				description={m.staff_members_id_panels_bands_panel_no_published_show_credit()}
			/>
		{:else}
			<p class="mb-3 text-muted">
				{m.staff_members_id_panels_bands_panel_upcoming_played({
					length: shows.upcoming.length,
					pastCount: shows.pastCount
				})}
			</p>
			<Table>
				{#snippet head()}
					<th>{m.staff_show()}</th>
					<th class="col-support">{m.staff_members_id_panels_bands_panel_with()}</th>
					<th class="col-extra">{m.staff_date()}</th>
				{/snippet}
				{#each [...shows.upcoming, ...shows.past] as show (show.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/events/${show.id}`)}>
						<td class="cell-primary"><EntityIdentity ref={show.ref} /></td>
						<!-- The credited band is a record of its own, so it keeps its
						     column and reaches its own page. -->
						<td class="col-support"><EntityChip ref={show.band} icon={false} /></td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(show.startsAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList title={m.staff_community_listings()} result={getUserListings(id)}>
	{#snippet children(data)}
		{@const all = [...data.rejected, ...data.listings]}
		{#if all.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_bands_panel_no_listings()}
				description={m.staff_members_id_panels_bands_panel_member_has_never_submitt()}
			/>
		{:else}
			<p class="mb-3 text-muted">
				{m.staff_members_id_panels_bands_panel_currently_public_calenda({
					publishedCount: data.publishedCount
				})}
			</p>
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_listing()}</th>
					<th class="col-extra">{m.staff_date()}</th>
				{/snippet}
				{#each all as e (e.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/events/${e.id}`)}>
						<td class="w-px"><StatusBadge status={e.status} /></td>
						<td class="cell-primary">
							<EntityIdentity ref={e.ref}>
								{#snippet subtitle()}{e.reviewNotes}{/snippet}
							</EntityIdentity>
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(e.startsAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList
	title={m.staff_members_id_panels_bands_panel_tickets_rsvps()}
	result={getUserTicketsAndRsvps(id)}
>
	{#snippet children(data)}
		{#if data.tickets.length === 0 && data.rsvps.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_bands_panel_no_tickets_rsvps()}
				description={m.staff_members_id_panels_bands_panel_member_has_not_booked_on()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_event()}</th>
					<th class="col-support">{m.staff_kind()}</th>
					<th class="col-extra">{m.staff_date()}</th>
				{/snippet}
				{#each data.tickets as t (t.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/events/${t.eventId}`)}>
						<td class="w-px"><StatusBadge status={t.status} /></td>
						<td class="cell-primary">
							<EntityIdentity ref={t.ref}>
								{#snippet subtitle()}{t.code}{/snippet}
							</EntityIdentity>
						</td>
						<td class="col-support">{m.staff_members_id_panels_bands_panel_ticket()}</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(t.eventStartsAt)}</td>
					</tr>
				{/each}
				{#each data.rsvps as r (r.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/events/${r.eventId}`)}>
						<td class="w-px"><StatusBadge status={r.eventStatus} /></td>
						<td class="cell-primary"><EntityIdentity ref={r.ref} /></td>
						<td class="col-support">{m.staff_members_id_panels_bands_panel_rsvp()}</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(r.startsAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>
