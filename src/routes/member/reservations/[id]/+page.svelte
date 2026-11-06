<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { formatDollars } from '#lib/utils/format.js';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { getReservationDetail } from '#lib/remote/reservations.remote.js';
	import { resolve } from '$app/paths';
	import UnconfirmedNotice from '#lib/components/reservations/UnconfirmedNotice.svelte';
	import { EntityIdentity, EntityChip } from '#lib/components/ui/entity/index.js';
	import {
		CancelReservationAction,
		ConfirmWaitlistedAction
	} from '#lib/components/actions/index.js';
	import ReaderPayment from './ReaderPayment.svelte';
	import { memberPayAction } from '#lib/utils/reservation-actions.js';
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

<PageHeader width="md" title={m.member_reservations_id_reservation()} />
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
			<Fact label={m.member_reservations_id_booked()}><EntityChip ref={data.band} /></Fact>
		{/if}
		{#if res.notes}
			<Fact label={m.member_reservations_id_notes()} wrap>{res.notes}</Fact>
		{/if}
	</DefinitionList>

	{#if paidAtReader && res.status === 'confirmed'}
		<Alert type="success">{m.member_reservations_id_paid_booking_confirmed()}</Alert>
	{/if}

	{#if res.status === 'confirmed'}
		<!-- A card only when there is a code to frame. Four of the five branches
		     were a single paragraph inside an `InfoCard` titled "Door Code",
		     which is a box around one sentence (#1061). -->
		{#if res.lockCode && res.lockSyncedAt}
			<InfoCard title={m.member_reservations_id_door_code()}>
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{res.lockCode}</p>
				<p class="text-muted">
					{m.member_reservations_id_enter_code_door_keypad_get()}
				</p>
			</InfoCard>
		{:else if data.fallbackCode}
			<!-- Their own code has not reached the lock, and they are due in now.
			     The break-glass code was synced long ago, so it opens the door
			     even while the lock is offline. -->
			<InfoCard title={m.member_reservations_id_door_code()}>
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{data.fallbackCode}</p>
				<p class="text-muted">
					{m.member_reservations_id_we_couldn_t_confirm_usual()}
				</p>
			</InfoCard>
		{:else if data.inAccessWindow}
			<!-- Their session is running and nothing here opens the door: no
			     break-glass code is confirmed on the lock right now, which happens
			     mid-rotation. Standing outside is the failure mode. -->
			<Alert type="error">
				<ParaglideMessage message={m.member_reservations_id_code_hasn_t_reached_door} inputs={{}}
					>{#snippet a({ children })}<a class="link" href={resolve('contact')}
							>{@render children?.()}</a
						>{/snippet}</ParaglideMessage
				>
			</Alert>
		{:else if res.lockCode}
			<p class="text-muted">
				{m.member_reservations_id_door_code_issued_but_door()}
			</p>
		{:else}
			<p class="text-muted">{m.member_reservations_id_door_code_will_appear_here()}</p>
		{/if}
	{/if}

	{#if res.status === 'scheduled'}
		<!-- The card carries the amount, the due date and the confirmation window;
		     without them here, opening a booking to check what is outstanding
		     tells a member less than the list they came from (#895). -->
		<InfoCard title={m.member_reservations_id_not_confirmed_yet()}>
			<p>
				<ParaglideMessage
					message={m.member_reservations_id_due_cash_at_door_card}
					inputs={{ formatDollars: formatDollars(data.totalCents) }}
					>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
						>{/snippet}</ParaglideMessage
				>
			</p>
			<UnconfirmedNotice startsAt={res.startsAt} class="space-y-1 text-muted" />
		</InfoCard>

		<Button href="/member/reservations/{res.id}/pay" variant="primary" class="w-full">
			{m.member_reservations_id_pay_session()}
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
						{(isPast ? m.member_reservations_id_due : m.member_reservations_id_due_at_door)({
							formatDollars: formatDollars(res.cashDueCents ?? 0)
						})}
					</span>
				{/if}
				<Button href="/member/reservations/{res.id}/pay" variant="primary" outline>
					{m.member_pay_online()}
				</Button>
			{/if}
			{#if !isPast}
				<CancelReservationAction reservation={res} onsuccess={refresh} variant="error" outline />
			{/if}
		</div>
	{/if}

	<Button href="/member/reservations" variant="ghost" class="w-full"
		>{m.member_back_reservations()}</Button
	>
</PageContent>
