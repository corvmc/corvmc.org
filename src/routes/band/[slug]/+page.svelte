<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import BandReservationCard from '#lib/components/reservations/BandReservationCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { getBandUpcoming } from '#lib/remote/bands.remote.js';
	import { getBandLayoutContext } from './layout-context';
	import { resolve } from '$app/paths';
	import * as env from '$app/env/public';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import AddressCard from '#lib/components/ui/AddressCard.svelte';
	import { canonicalAddress } from '#lib/utils/canonical-address.js';
	import PressKitCard from './PressKitCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { getPressKitProgress } from '#lib/remote/press-kit.remote.js';
	import { retryQuery } from '#lib/utils/retry-query.js';

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

<PageHeader title={m.band_slug_dashboard()} subtitle={band.name} />
<PageContent>
	{#if address}
		<AddressCard url={address} title={m.band_slug_band_s_address()}>
			{m.band_slug_put_flyer_bio_goes_s({ name: band.name })}
		</AddressCard>
	{/if}

	{#if isOwnerOrAdmin}
		<svelte:boundary>
			<PressKitCard slug={band.slug} />

			{#snippet failed(_error, reset)}
				<Alert type="warning" reset={() => retryQuery(getPressKitProgress(band.slug), reset)}>
					{m.band_slug_press_kit_progress_didn_t()}
				</Alert>
			{/snippet}
		</svelte:boundary>
	{/if}

	<!-- Band overview -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<StatCard title={m.band_members()} value={band.memberCount} size="sm" />
		<StatCard
			title={m.band_slug_role()}
			value={layout.userRole}
			size="sm"
			valueClass="capitalize"
		/>
	</div>

	<!-- Upcoming reservations. The only thing on this page that waits: everything
	     above comes from `bandLayout`, which is already resolved, and awaiting
	     one list at the top left the whole dashboard a spinner (#1051). -->
	<section>
		{#await upcoming}
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-lg font-semibold">{m.band_slug_upcoming_sessions()}</h2>
			</div>
			<div class="flex justify-center py-8">
				<span class="loading loading-lg loading-spinner"></span>
			</div>
		{:then sessions}
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-lg font-semibold">
					{m.band_slug_upcoming_sessions()}
					{#if sessions.length > 0}
						<span class="font-normal text-base-content/60">({sessions.length})</span>
					{/if}
				</h2>
				<a href={resolve(`band/${band.slug}/reservations`)} class="link text-sm link-primary">
					{m.band_slug_view_all()}
				</a>
			</div>

			{#if sessions.length === 0}
				<EmptyState message={m.band_slug_message()} />
			{:else}
				<div class="flex flex-col gap-2">
					{#each sessions as res (res.id)}
						<BandReservationCard reservation={res} slug={band.slug} />
					{/each}
				</div>
			{/if}
		{/await}
	</section>

	<!-- Quick links -->
	<div class="flex gap-3">
		<Button href="/band/{band.slug}/members" variant="default" size="sm" outline
			>{m.band_slug_manage_members()}</Button
		>
		{#if isOwnerOrAdmin}
			<Button href="/band/{band.slug}/edit" variant="default" size="sm" outline
				>{m.band_slug_edit_band_profile()}</Button
			>
		{/if}
	</div>
</PageContent>
