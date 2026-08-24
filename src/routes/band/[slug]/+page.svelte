<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Button from '$lib/components/shared/Button.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { getBandUpcoming } from '$lib/remote/bands.remote';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import StatCard from '$lib/components/shared/StatCard.svelte';

	let layout = $derived(await getBandLayout(page.params.slug!));

	const band = $derived(layout.band);
	const isOwnerOrAdmin = $derived(layout.userRole === 'owner' || layout.userRole === 'admin');

	let upcoming = $derived(getBandUpcoming(band.id));
</script>

<PageHeader title="Dashboard" subtitle={band.name} />
<PageContent>
	{#await upcoming}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{:then sessions}
		<!-- Band overview -->
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<StatCard title="Members" value={band.memberCount} size="sm" />
			<StatCard title="Upcoming Sessions" value={sessions.length} size="sm" />
			<StatCard title="Your Role" value={layout.userRole} size="sm" valueClass="capitalize" />
		</div>

		<!-- Upcoming reservations -->
		<section>
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-lg font-semibold">Upcoming Sessions</h2>
				<a href={resolve(`/band/${band.slug}/reservations`)} class="link link-primary text-sm">
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
