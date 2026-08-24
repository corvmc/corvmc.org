<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { formatDollars } from '$lib/utils/format';
	import {
		CancelReservationAction,
		ConfirmReservationAction,
		ConfirmWaitlistedAction
	} from '$lib/components/shared/actions';
	import ReservationSummary from '$lib/components/shared/reservations/ReservationSummary.svelte';
	import type { Reservation } from '$lib/server/db/schema';
	import { resolve } from '$app/paths';
	import { withinConfirmationWindow, confirmWindowOpensAt } from '$lib/config';
	import { isTerminalStatus } from '$lib/utils/reservation-actions';

	import { isToday, isTomorrow, isThisWeek, format } from 'date-fns';

	let { reservation, onchange }: { reservation: Reservation; onchange?: () => void } = $props();

	let isTerminal = $derived(isTerminalStatus(reservation.status));
	let isPast = $derived(reservation.startsAt.getTime() <= Date.now());
	// Members may only confirm (without paying) within the window; before then we
	// show when it opens and offer paying to lock the slot in early.
	let canConfirm = $derived(withinConfirmationWindow(reservation.startsAt));
</script>

<div
	class="relative my-2 flex rounded-md border-[2.5px] border-(--cmc-brown) bg-base-100 {reservation.status}"
>
	<div class="date-block">
		{#if !isTerminal}
			{#if isThisWeek(reservation.startsAt)}
				<span class="upcoming-tag">
					{#if isToday(reservation.startsAt)}
						Today
					{:else if isTomorrow(reservation.startsAt)}
						Tomorrow
					{:else}
						This Week
					{/if}
				</span>
			{/if}
		{/if}
		<span>{format(reservation.startsAt, 'E')}</span>
		<span class="text-3xl">{format(reservation.startsAt, 'd')}</span>
		<span>{format(reservation.startsAt, 'MMM')}</span>
	</div>
	<div class="flex flex-1 flex-col">
		<a
			href={resolve('/member/reservations/[id]', { id: reservation.id })}
			class="block hover:bg-base-200/40"
		>
			<ReservationSummary {reservation} class="space-y-1 p-2 px-3" />
			{#if reservation.status === 'confirmed' && reservation.lockCode}
				<p class="px-3 pb-1 text-sm">
					Door code: <span class="font-mono font-bold tracking-wider">{reservation.lockCode}</span>
				</p>
			{/if}
		</a>
		<span class="reservation-status">{reservation.status.replace('_', ' ')}</span>
		{#if !isPast && reservation.status === 'scheduled' && !canConfirm}
			<!-- Hint lives above the action row so it never wraps behind the buttons. -->
			<p class="px-3 text-right text-subtle">
				Confirm from {format(confirmWindowOpensAt(reservation.startsAt), 'MMM d')}
			</p>
		{/if}
		<div class="mt-5 flex h-0 items-center justify-end gap-2 px-2">
			{#if !isPast && ['waitlisted', 'scheduled', 'confirmed'].includes(reservation.status)}
				<CancelReservationAction
					{reservation}
					onsuccess={onchange}
					variant="error"
					size="xs"
					outline
				/>
				{#if reservation.status === 'waitlisted' && reservation.waitlistNotifiedAt}
					<ConfirmWaitlistedAction {reservation} onsuccess={onchange} variant="success" size="xs" />
				{:else if reservation.status === 'scheduled'}
					{#if canConfirm}
						<ConfirmReservationAction
							{reservation}
							onsuccess={onchange}
							variant="primary"
							size="xs"
						/>
					{:else}
						<Button
							href={resolve('/member/reservations/[id]/pay', { id: reservation.id })}
							variant="primary"
							size="xs"
							outline
						>
							Pay to reserve
						</Button>
					{/if}
				{:else if reservation.status === 'confirmed' && !reservation.paidAt && (reservation.cashDueCents == null || reservation.cashDueCents > 0)}
					{#if (reservation.cashDueCents ?? 0) > 0}
						<span class="text-xs font-medium"
							>${formatDollars(reservation.cashDueCents ?? 0)} due at door</span
						>
					{/if}
					<Button
						href={resolve('/member/reservations/[id]/pay', { id: reservation.id })}
						variant="primary"
						size="xs"
						outline
					>
						Pay online
					</Button>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style lang="postcss">
	@reference '#/routes/layout.css';

	.upcoming-tag {
		@apply absolute -top-3 left-0 ml-[-2.5px] rounded-sm rounded-bl-none border-[2.5px] border-(--cmc-brown) bg-error px-1 text-[.6rem] font-bold tracking-wide text-error-content uppercase;
	}

	.date-block {
		@apply relative flex w-20 shrink-0 flex-col items-center justify-center rounded-l-sm border-r-2 border-(--cmc-brown) py-3 text-xs leading-tight font-bold;
	}

	.confirmed .date-block {
		@apply bg-secondary text-secondary-content;
	}

	.scheduled .date-block {
		@apply bg-warning text-warning-content;
	}

	.completed .date-block {
		@apply bg-success text-success-content;
	}

	/* Class comes from the raw status value, so underscore — not hyphen. */
	.no_show .date-block {
		@apply bg-base-300 text-error;
	}

	.cancelled .date-block {
		@apply bg-base-300 text-base-content/50;
	}

	.reservation-status {
		@apply absolute top-2 right-2 text-xs font-bold tracking-wide uppercase opacity-50;
		font-family: var(--font-mono);
	}
</style>
