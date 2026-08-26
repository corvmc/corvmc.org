<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Form from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { cancelBandReservation, getBandReservationsPage } from '$lib/remote/reservations.remote';
	import CreateModal from './CreateModal.svelte';
	import { getBandLayoutContext } from '../layout-context';
	import { page } from '$app/state';

	const { fields: cancelFields } = cancelBandReservation;

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	// One query. Membership and contact are still resolved before render and handed down, so
	// the step components stay synchronous — they just arrive on the same request now.
	const page_ = $derived(await getBandReservationsPage(page.params.slug!));
	const data = $derived(page_.reservations);
	const membership = $derived(page_.membership);
	const contact = $derived(page_.contact);
	const upcoming = $derived(data.upcoming);
	const past = $derived(data.past);
	const band = $derived(layout.band);
	let activeTab = $state<'upcoming' | 'past'>('upcoming');

	/**
	 * Nothing here refreshes `getBandReservations` by hand, and that is deliberate.
	 *
	 * `Form` submits through `remote.enhance`, and SvelteKit's single-flight
	 * update already re-fetches every query this page is using once the
	 * submission lands — `getBandReservations` included. Calling `.refresh()` from
	 * `onsuccess` on top of that put two concurrent runs on the one cached Query
	 * instance, and the loser left the derived reading a stale value (Svelte
	 * reports it as `derived_inert`). The booking was written, the server sent it
	 * back on both responses, and the list still said "No upcoming sessions" until
	 * the page was reloaded.
	 *
	 * Rare enough to look like a flake and common enough to hit a real member: it
	 * took a loaded machine to reproduce, where it failed 3 runs in 5.
	 * `e2e/band-reservations.e2e.ts` is the regression test.
	 */
</script>

<PageHeader title="Reservations" subtitle={band.name}>
	<CreateModal
		hasSustainingMember={membership.hasSustainingMember}
		needsPhone={contact.needsPhone}
	/>
</PageHeader>
<PageContent width="2xl">
	<TabBar
		tabs={[
			{ key: 'upcoming', label: `Upcoming (${upcoming.length})` },
			{ key: 'past', label: 'Past' }
		]}
		active={activeTab}
		onchange={(key) => (activeTab = key as 'upcoming' | 'past')}
	/>

	{#if activeTab === 'upcoming'}
		{#if upcoming.length === 0}
			<EmptyState
				title="No upcoming sessions"
				description="Book the practice space and it'll show up here for the whole band."
			/>
		{:else}
			<div class="space-y-3">
				{#each upcoming as res (res.id)}
					{@const cancel = cancelBandReservation.for(res.id)}
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
							<div class="flex items-center gap-2">
								<StatusBadge status={res.status} />
								<!-- `canCancel` comes from the server: `cancel()` authorizes on
							     createdByUserId, so this used to render Cancel for every
							     bandmate and answer with an error toast for all but the
							     one who booked. Band admins may cancel any of the band's
							     sessions. Nothing is shown to someone who can't — a
							     disabled button would just raise the same question. -->
								{#if res.canCancel && (res.status === 'scheduled' || res.status === 'confirmed')}
									<Form
										remote={cancel}
										onsuccess={() => toast.success('Reservation cancelled')}
										onfailure={() => toast.error('Failed to cancel')}
									>
										<input {...cancelFields.reservationId.as('hidden', res.id)} />
										<SubmitButton label="Cancel" variant="ghost" size="xs" />
									</Form>
								{/if}
							</div>
						</CardBody>
					</Card>
				{/each}
			</div>
		{/if}
	{/if}

	{#if activeTab === 'past'}
		{#if past.length === 0}
			<EmptyState message="No past reservations." />
		{:else}
			<div class="space-y-3">
				{#each past as res (res.id)}
					<Card>
						<CardBody row class="py-4">
							<EntityIdentity ref={res.ref} size="md">
								{#snippet subtitle()}
									{res.ref.subtitle}
									{#if res.bookedBy.id}
										&middot; Booked by {res.bookedBy.title}
									{/if}
								{/snippet}
							</EntityIdentity>
							<StatusBadge status={res.status} />
						</CardBody>
					</Card>
				{/each}
			</div>
		{/if}
	{/if}
</PageContent>
