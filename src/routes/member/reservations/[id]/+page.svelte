<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { formatDollars } from '#lib/utils/format.js';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { getReservationDetail } from '#lib/remote/reservations.remote.js';
	import DoorCheckIn from '#lib/components/reservations/DoorCheckIn.svelte';
	import { EntityIdentity, EntityChip } from '#lib/components/ui/entity/index.js';
	import {
		CancelReservationAction,
		ConfirmWaitlistedAction
	} from '#lib/components/actions/index.js';
	import ReaderPayment from './ReaderPayment.svelte';
	import DoorCodeHeld from '#lib/components/reservations/booking/DoorCodeHeld.svelte';
	import { memberPayAction, trackDetail } from '#lib/utils/reservation-actions.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	let paidAtReader = $state(false);
	let data = $derived(await getReservationDetail(params.id));

	const res = $derived(data.reservation);
	const isPast = $derived(res.startsAt.getTime() <= Date.now());
	const owesBalance = $derived(memberPayAction(res) === 'balance');

	const refresh = () => getReservationDetail(params.id).refresh();

	function readerPaid() {
		paidAtReader = true;
		refresh();
	}
</script>

<PageHeader width="md" title={m.member_reservations_id_reservation_title()} />
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
			<Fact label={m.member_reservations_id_booked_label()}><EntityChip ref={data.band} /></Fact>
		{/if}
		{#if res.notes}
			<Fact label={m.member_reservations_id_notes_label()} wrap>{res.notes}</Fact>
		{/if}
	</DefinitionList>

	{#if paidAtReader && res.status === 'confirmed'}
		<Alert type="success">{m.member_reservations_id_paid_booking_confirmed_body()}</Alert>
	{/if}

	{#if res.status === 'confirmed'}
		<!-- Held for a fee owed (#2874); otherwise the door page opens it (#2120). -->
		{#if res.codeWithheld}
			<DoorCodeHeld dueOn={data.paymentDueOn} />
		{:else}
			<DoorCheckIn now={data.inAccessWindow} />
		{/if}
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
	{#if owesBalance || (!isPast && ['waitlisted', 'confirmed'].includes(res.status))}
		<div class="flex flex-wrap items-center gap-2">
			{#if !isPast && res.status === 'waitlisted' && res.waitlistNotifiedAt}
				<ConfirmWaitlistedAction reservation={res} onsuccess={refresh} variant="success" />
			{/if}
			<!-- Not behind !isPast: a balance is still owed after the session (#1952). -->
			{#if owesBalance}
				{#if trackDetail(res) === 'cash_due'}
					<span class="text-sm font-medium">
						{(isPast
							? m.member_reservations_id_due_text
							: m.member_reservations_id_due_at_door_text)({
							formatDollars: formatDollars(res.cashDueCents ?? 0)
						})}
					</span>
				{/if}
				<Button href="/member/reservations/{res.id}/pay" variant="primary" outline>
					{m.member_pay_online_label()}
				</Button>
			{/if}
			{#if !isPast}
				<CancelReservationAction reservation={res} onsuccess={refresh} variant="error" outline />
			{/if}
		</div>
	{/if}

	<Button href="/member/reservations" variant="ghost" class="w-full"
		>{m.member_back_reservations_label()}</Button
	>
</PageContent>
