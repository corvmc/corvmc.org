<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getBandUpcoming } from '$lib/remote/bands.remote';
	import { getBandLayoutContext } from './layout-context';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import AddressCard from '$lib/components/ui/AddressCard.svelte';
	import { canonicalAddress } from '$lib/utils/canonical-address';

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);

	const band = $derived(layout.band);
	const isOwnerOrAdmin = $derived(layout.userRole === 'owner' || layout.userRole === 'admin');

	// Every band has this, free. Settings was the only place it appeared, framed
	// as a value to change; here it is the address they hand out.
	const address = $derived(
		canonicalAddress({ kind: 'group', slug: band.slug }, { siteUrl: env.PUBLIC_SITE_URL })
	);

	let upcoming = $derived(getBandUpcoming(band.id));
</script>

<PageHeader title="Dashboard" subtitle={band.name} />
<PageContent>
	{#await upcoming}
		<div class="flex justify-center py-12">
			<span class="loading loading-lg loading-spinner"></span>
		</div>
	{:then sessions}
		{#if address}
			<AddressCard url={address} title="Your act's address">
				Put this on a flyer or in a bio — it goes to {band.name}'s page.
			</AddressCard>
		{/if}

		{#if isOwnerOrAdmin}
			<svelte:boundary>
				<PressKitCard slug={band.slug} />
			</svelte:boundary>
		{/if}

		<!-- Act overview -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<StatCard title="Members" value={band.memberCount} size="sm" />
			<StatCard title="Upcoming Sessions" value={sessions.length} size="sm" />
			<StatCard title="Your Role" value={layout.userRole} size="sm" valueClass="capitalize" />
		</div>

		<!-- Upcoming reservations -->
		<section>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-lg font-semibold">Upcoming Sessions</h2>
				<a href={resolve(`/band/${band.slug}/reservations`)} class="link text-sm link-primary">
					View all
				</a>
			</div>

			{#if sessions.length === 0}
				<EmptyState message="No upcoming sessions scheduled." />
			{:else}
				<div class="grid grid-cols-1 gap-3">
					{#each sessions as res (res.id)}
						<Card>
							<CardBody row class="py-4">
								<EntityIdentity ref={res.ref} size="md">
									{#snippet subtitle()}
										{res.ref.subtitle}
										{#if res.bookedBy.id}
											&middot; Booked by {res.bookedBy.title}
										{/if}
										{#if res.notes}
											&middot; {res.notes}
										{/if}
									{/snippet}
								</EntityIdentity>
								<StatusBadge status={res.status} />
							</CardBody>
						</Card>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Quick links -->
		<div class="flex gap-3">
			<Button href="/band/{band.slug}/members" variant="default" size="sm" outline
				>Manage Members</Button
			>
			{#if isOwnerOrAdmin}
				<Button href="/band/{band.slug}/edit" variant="default" size="sm" outline
					>Edit Act Profile</Button
				>
			{/if}
		</div>
	{/await}
</PageContent>
