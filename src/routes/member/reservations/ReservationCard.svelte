<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { formatDollars, formatDateShort } from '$lib/utils/format';
	import {
		CancelReservationAction,
		ConfirmReservationAction,
		ConfirmWaitlistedAction
	} from '$lib/components/actions';
	import ReservationCardShell from '$lib/components/reservations/ReservationCardShell.svelte';
	import ReservationSummary from '$lib/components/reservations/ReservationSummary.svelte';
	import type { Reservation } from '$lib/server/db/schema';
	import { resolve } from '$app/paths';
	import { withinConfirmationWindow, confirmWindowOpensAt } from '$lib/config';

	let { reservation, onchange }: { reservation: Reservation; onchange?: () => void } = $props();

	let isPast = $derived(reservation.startsAt.getTime() <= Date.now());
	// Members may only confirm (without paying) within the window; before then we
	// show when it opens and offer paying to lock the slot in early.
	let canConfirm = $derived(withinConfirmationWindow(reservation.startsAt));
</script>

<ReservationCardShell startsAt={reservation.startsAt} status={reservation.status}>
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
	{#if !isPast && reservation.status === 'scheduled' && !canConfirm}
		<!-- Hint lives above the action row so it never wraps behind the buttons. -->
		<p class="px-3 text-right text-subtle">
			Confirm from {formatDateShort(confirmWindowOpensAt(reservation.startsAt))}
		</p>
	{/if}

	{#snippet actions()}
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
	{/snippet}
</ReservationCardShell>
