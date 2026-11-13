<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { isEventHold } from '#lib/config.js';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { isNoteworthyStatus } from '#lib/components/ui/entity/registry.js';
	import CashReceivedAction from '#lib/components/actions/CashReceivedAction.svelte';
	import NoShowReservationAction from '#lib/components/actions/NoShowReservationAction.svelte';
	import CompleteReservationAction from '#lib/components/actions/CompleteReservationAction.svelte';
	import { formatTimeRange, formatPaymentBreakdown } from '#lib/utils/format.js';
	import {
		visibleActions,
		reservationPaymentState,
		owedAfterSession
	} from '#lib/utils/reservation-actions.js';
	import type { getStaffReservationsPage } from '#lib/remote/reservations.remote.js';
	import { paymentStatus } from './payment-status';
	import { withQuery } from '#lib/utils/with-query.js';
	import { resolve } from '$app/paths';

	type Page = Awaited<ReturnType<typeof getStaffReservationsPage>>;
	type Reservation = Extract<Page['list']['rows'][number], { kind: 'reservation' }>;

	/**
	 * One reservation as a folded table row, in the card grammar of ui-patterns:
	 * status as one mark at the title, facts labelled, actions full width at 44px.
	 * Checked at the door on a phone, so nothing here depends on hover.
	 */
	let {
		reservation: r,
		query,
		current,
		rates
	}: {
		reservation: Reservation;
		/** The list's filter query, carried onto the reservation's link. */
		query: string;
		current: boolean;
		rates: Promise<Page['hourlyRates']>;
	} = $props();

	const flags = $derived(
		[
			r.recurringSeriesId && m.staff_recurring_text(),
			r.bookerType === 'instructor' && m.staff_reservations_teaching_text(),
			r.isFirstReservation && m.staff_first_reservation_text(),
			r.notes && m.staff_reservations_member_left_note_text()
		].filter((f): f is string => !!f)
	);
	const hasPayment = $derived(!isEventHold(r.bookerType));
	const owed = $derived(owedAfterSession(r));
	const canComplete = $derived(
		visibleActions(r.status, r.startsAt, r.endsAt, r.stripePaymentRecordId).has('complete')
	);
</script>

<li
	class="-mx-2 space-y-2 rounded-box border-b border-base-300 px-2 py-3 {current
		? 'bg-base-200'
		: ''}"
	aria-current={current ? 'page' : undefined}
>
	<div class="flex items-center gap-2">
		{#if isNoteworthyStatus(r.status)}
			<StatusBadge status={r.status} />
		{/if}
		<a
			href={withQuery(resolve(`staff/reservations/${r.id}`), query)}
			class="inline-flex min-h-11 items-center text-lg font-medium hover:underline"
		>
			{formatTimeRange(r.startsAt, r.endsAt)}
		</a>
	</div>
	<EntityChip ref={r.booker} />

	{#if hasPayment || flags.length}
		<DefinitionList layout="strip">
			{#if hasPayment}
				{#await rates then table}
					{@const state = reservationPaymentState(r)}
					{@const ps = paymentStatus(state)}
					<Fact label={m.staff_payment_label()}>
						<span class="inline-flex flex-wrap items-center gap-1">
							<ps.icon size={16} class={ps.color} />
							<span class="font-medium"
								>{state === 'cash_due' || state === 'unpaid' ? m.staff_due_text() : ps.label}</span
							>
							<span class="text-muted" class:line-through={state === 'comped'}>
								{formatPaymentBreakdown(r.startsAt, r.endsAt, table[r.bookerType], r.creditsUsed)}
							</span>
						</span>
					</Fact>
				{:catch}
					<!-- DataList takes this rejection to the boundary. -->
				{/await}
			{/if}
			{#if flags.length}
				<Fact label={m.staff_details_label()} value={flags.join(', ')} />
			{/if}
		</DefinitionList>
	{/if}

	{#if owed}
		<div class="grid grid-cols-2 gap-2">
			<CashReceivedAction
				reservation={r}
				size="md"
				shape="block"
				class="min-h-11"
				data-testid="cash-received"
			/>
			<NoShowReservationAction
				reservation={r}
				variant="error"
				size="md"
				shape="block"
				outline
				class="min-h-11"
				data-testid="no-show"
			/>
		</div>
	{:else if canComplete}
		<div class="grid">
			<CompleteReservationAction reservation={r} size="md" shape="block" class="min-h-11" />
		</div>
	{/if}
</li>
