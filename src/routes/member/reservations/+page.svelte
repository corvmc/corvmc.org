<script lang="ts">
	import ManageRecurringReservations from './ManageRecurringReservations.svelte';
	import BookingPolicy from '$lib/components/reservations/BookingPolicy.svelte';
	import FreeHoursRemaining from '$lib/components/member/membership/FreeHoursRemaining.svelte';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		confirmWaitlisted,
		getReservations,
		getMembershipStatus,
		getBookingContact
	} from '$lib/remote/reservations.remote';

	const { fields } = confirmWaitlisted;
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import CreateModal from './CreateModal.svelte';
	import ReservationCard from './ReservationCard.svelte';
	import { Tabs } from 'bits-ui';
	import clsx from 'clsx';
	import { format } from 'date-fns';

	let activeTab = $state<'active' | 'all'>('active');

	// These two MUST stay above the `await`s below. A declaration that follows a
	// top-level await is compiled as "blocked", and Svelte hangs that blocker on
	// every template node that reads it — so `{#each await activeReservations}`
	// compiled to `$.async(node, [blocker], [expression], …)`. That is the one
	// shape that reaches `flatten`'s deferred branch, where `restore()` may
	// reactivate a null batch (it optional-chains, conceding as much) and
	// `async_derived` then dereferences `current_batch.async_deriveds` unguarded:
	// an unhandled TypeError that kills the page, and the Confirm button with it
	// (JAVASCRIPT-SVELTEKIT-25). Unfixed in every published Svelte. Declared
	// first, the blocker list is empty and `flatten` takes its synchronous path.
	// `async-effect-shape.spec.ts` fails the build if this order is undone.
	let activeReservations = $state(getReservations({ after: new Date().toISOString() }));
	let allReservations = $state(getReservations({ includeTerminal: true }));

	let creditData = $derived(await getMembershipStatus());
	const isSustaining = $derived(creditData.isSustainingMember);

	// Staff can't follow up on a booking they can't call about, so the wizard
	// collects a number inline when the member has none on file.
	let contact = $derived(await getBookingContact());

	// Remote queries aren't refreshed by invalidateAll() — only by their own
	// refresh() method. Mutations (book/cancel/confirm) must call this so the
	// lists (and free-hours balance) update without a manual page reload.
	function refreshReservations() {
		activeReservations.refresh();
		allReservations.refresh();
		getMembershipStatus().refresh();
		getBookingContact().refresh();
	}

	// Waitlist confirmation via ?confirm={id}
	const confirmId = $derived(page.url.searchParams.get('confirm'));
	let confirmModalOpen = $state(false);
	let confirmReservation = $state<Awaited<typeof activeReservations>[number] | null>(null);

	$effect(() => {
		if (confirmId) {
			activeReservations.then((reservations) => {
				const match = reservations.find(
					(r) => r.id === confirmId && r.status === 'waitlisted' && r.waitlistNotifiedAt
				);
				if (match) {
					confirmReservation = match;
					confirmModalOpen = true;
				}
			});
		}
	});

	function closeConfirmModal() {
		confirmModalOpen = false;
		confirmReservation = null;
		goto(resolve('/member/reservations'), { replaceState: true });
	}
</script>

<PageHeader title="Reserve Practice Space">
	<CreateModal {isSustaining} needsPhone={contact.needsPhone} onbooked={refreshReservations} />
</PageHeader>
<PageContent>
	<BookingPolicy />
	<FreeHoursRemaining />
	<article class="@container">
		<Tabs.Root bind:value={activeTab}>
			<header class="mb-4 flex w-full items-center justify-between">
				<h2 class="title">My Reservations</h2>
				<Tabs.List class="join">
					<Tabs.Trigger
						value="active"
						class={clsx('btn join-item btn-sm', {
							'latched btn-primary': activeTab === 'active'
						})}>Active</Tabs.Trigger
					>
					<Tabs.Trigger
						value="all"
						class={clsx('btn join-item btn-sm', {
							'latched btn-primary': activeTab === 'all'
						})}>All</Tabs.Trigger
					>
				</Tabs.List>
			</header>
			<Tabs.Content value="active" class="card-grid">
				{#each await activeReservations as reservation (reservation.id)}
					<ReservationCard {reservation} onchange={refreshReservations} />
				{:else}
					<EmptyState
						message="No upcoming reservations. Use Reserve Space above to book your next practice slot."
						class="col-span-full"
					/>
				{/each}
			</Tabs.Content>
			<Tabs.Content value="all" class="card-grid">
				{#each await allReservations as reservation (reservation.id)}
					<ReservationCard {reservation} onchange={refreshReservations} />
				{:else}
					<EmptyState
						message="No reservations yet. Use Reserve Space above to book your first practice slot."
						class="col-span-full"
					/>
				{/each}
			</Tabs.Content>
		</Tabs.Root>
	</article>
	<ManageRecurringReservations />
</PageContent>

{#if confirmReservation}
	<Modal
		bind:open={confirmModalOpen}
		title="Slot Available"
		maxWidth="max-w-md"
		onclose={closeConfirmModal}
	>
		<Form
			remote={confirmWaitlisted}
			successToast="Reservation confirmed"
			onsuccess={async () => {
				closeConfirmModal();
				refreshReservations();
			}}
		>
			<div class="space-y-4">
				<p class="text-sm">A slot has opened up for your waitlisted reservation:</p>
				<div class="rounded-lg border border-base-300 bg-base-200/50 px-4 py-3">
					<p class="font-medium">{format(confirmReservation.startsAt, 'PPP')}</p>
					<p class="text-muted">
						{format(confirmReservation.startsAt, 'p')} – {format(confirmReservation.endsAt, 'p')}
					</p>
				</div>
				{#if confirmReservation.waitlistExpiresAt}
					<p class="text-subtle">
						Confirm by {format(confirmReservation.waitlistExpiresAt, 'PPP')} or the slot will be offered
						to someone else.
					</p>
				{/if}
				<input {...fields.id.as('hidden', confirmReservation.id)} />
				<div class="flex justify-end gap-2">
					<Button type="button" variant="default" size="sm" outline onclick={closeConfirmModal}
						>Dismiss</Button
					>
					<SubmitButton label="Confirm Reservation" variant="success" size="sm" />
				</div>
			</div>
		</Form>
	</Modal>
{/if}

<style lang="postcss">
	@reference '#/routes/layout.css';
	article .title {
		@apply shrink-0 text-2xl font-bold text-nowrap;
	}

	:global(.card-grid) {
		@apply grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3;
	}
</style>
