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
	import StatCard from '$lib/components/ui/StatCard.svelte';

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);

	const band = $derived(layout.band);
	const isOwnerOrAdmin = $derived(layout.userRole === 'owner' || layout.userRole === 'admin');

	let upcoming = $derived(getBandUpcoming(band.id));
</script>

<PageHeader title="Dashboard" subtitle={band.name} />
<PageContent>
	{#await upcoming}
		<div class="flex justify-center py-12">
			<span class="loading loading-lg loading-spinner"></span>
		</div>
	{:then sessions}
		<!-- Band overview -->
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
					>Edit Band Profile</Button
				>
			{/if}
		</div>
	{/await}
</PageContent>
