<script lang="ts">
	import { formatDollars } from '$lib/utils/format';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getReservationDetail } from '$lib/remote/reservations.remote';
	import { page } from '$app/state';
	import UnconfirmedNotice from '$lib/components/reservations/UnconfirmedNotice.svelte';
	import DoorCheckIn from '$lib/components/reservations/DoorCheckIn.svelte';
	import { EntityIdentity, EntityChip } from '$lib/components/ui/entity';
	import { CancelReservationAction, ConfirmWaitlistedAction } from '$lib/components/actions';
	import ReaderPayment from './ReaderPayment.svelte';
	import { memberPayAction } from '$lib/utils/reservation-actions';

	let paidAtReader = $state(false);
	let data = $derived(await getReservationDetail(page.params.id!));

	const res = $derived(data.reservation);
	const isPast = $derived(res.startsAt.getTime() <= Date.now());
	const owesBalance = $derived(memberPayAction(res) === 'balance');

	const refresh = () => getReservationDetail(page.params.id!).refresh();

	function readerPaid() {
		paidAtReader = true;
		refresh();
	}
</script>

<PageHeader width="md" title="Your Reservation" />
<PageContent width="md">
	<!--
		The detail-page shape ui-patterns names: `EntityIdentity size="lg"` over a
		`DefinitionList`. This was a hand-written hgroup and loose `<p>`s, with
		`toReservationRef` already available and unused (#1061).
	-->
	<EntityIdentity ref={data.ref} size="lg" status />

	<!-- No When/Time facts: `toReservationRef` builds the title out of exactly
	     those, and the identity above already reads "Mon, Sep 21 · 6:00–8:00 PM
	     / 2 hours". Restating them is the duplication #1043 removed from the
	     card. -->
	<DefinitionList>
		{#if data.band}
			<!-- Whose booking this is, when it is not simply the member's own. A
			     band booking looked identical to a personal one on this page. -->
			<Fact label="Booked for"><EntityChip ref={data.band} /></Fact>
		{/if}
		{#if res.notes}
			<Fact label="Notes" wrap>{res.notes}</Fact>
		{/if}
	</DefinitionList>

	{#if paidAtReader && res.status === 'confirmed'}
		<Alert type="success">Paid. Your booking is confirmed.</Alert>
	{/if}

	{#if res.status === 'confirmed'}
		<DoorCheckIn now={data.inAccessWindow} />
	{/if}

	{#if res.status === 'scheduled'}
		<!-- The card carries the amount, the due date and the confirmation window;
		     without them here, opening a booking to check what is outstanding
		     tells a member less than the list they came from (#895). -->
		<InfoCard title="Not confirmed yet">
			<p>
				<span class="font-medium">${formatDollars(data.totalCents)}</span>
				due — cash at the door, or card online.
			</p>
			<UnconfirmedNotice startsAt={res.startsAt} class="space-y-1 text-muted" />
		</InfoCard>

		<Button href="/member/reservations/{res.id}/pay" variant="primary" class="w-full">
			Pay for this session
		</Button>
	{/if}

	<!-- On the day, with a reader configured: the amount goes to the reader by
	     the door and the member taps there. -->
	{#if data.reader.payable}
		<ReaderPayment
			reservationId={res.id}
			canSimulate={data.reader.canSimulate}
			onpaid={readerPaid}
		/>
	{/if}

	<!--
		The same actions the row that links here offers. This page used to be a
		strict subset of that row on the two things a member opens a booking to
		do: cancelling was absent for every status, and a confirmed-but-unpaid
		booking offered no way to pay (#1062).
	-->
	{#if owesBalance || (!isPast && ['waitlisted', 'scheduled', 'confirmed'].includes(res.status))}
		<div class="flex flex-wrap items-center gap-2">
			{#if !isPast && res.status === 'waitlisted' && res.waitlistNotifiedAt}
				<ConfirmWaitlistedAction reservation={res} onsuccess={refresh} variant="success" />
			{/if}
			<!-- Not behind !isPast: a balance is still owed after the session (#1952). -->
			{#if owesBalance}
				{#if (res.cashDueCents ?? 0) > 0}
					<span class="text-sm font-medium">
						${formatDollars(res.cashDueCents ?? 0)} due{isPast ? '' : ' at door'}
					</span>
				{/if}
				<Button href="/member/reservations/{res.id}/pay" variant="primary" outline>
					Pay online
				</Button>
			{/if}
			{#if !isPast}
				<CancelReservationAction reservation={res} onsuccess={refresh} variant="error" outline />
			{/if}
		</div>
	{/if}

	<Button href="/member/reservations" variant="ghost" class="w-full">Back to Reservations</Button>
</PageContent>
