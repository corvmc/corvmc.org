<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { formatDate, formatTimeRange } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';

	type Slot = { date: string; startTime: string; endTime: string; startsAt: Date; endsAt: Date };

	/** Null once the member has booked; the card then renders nothing. */
	let { firstBooking }: { firstBooking: { slots: Slot[] } | null } = $props();

	// The booking page re-checks the pair against the booking rules: a link is a hint.
	const href = (s: Slot) =>
		`${resolve('member/reservations')}?${new URLSearchParams({ date: s.date, start: s.startTime, end: s.endTime })}`;
</script>

{#if firstBooking}
	<InfoCard
		title={m.member_first_booking_title({ reservation: m.term_reservation({ count: 1 }) })}
		testid="first-booking"
	>
		{#if firstBooking.slots.length > 0}
			<p class="text-muted">{m.member_first_booking_body()}</p>
			<div class="mt-3 flex flex-wrap gap-2">
				{#each firstBooking.slots as slot (slot.date)}
					<!-- A full reload, as the bands card does: the page opens its dialog on arrival. -->
					<Button href={href(slot)} variant="primary" size="sm" data-sveltekit-reload>
						{formatDate(slot.startsAt)} · {formatTimeRange(slot.startsAt, slot.endsAt)}
					</Button>
				{/each}
			</div>
		{:else}
			<p class="text-muted">{m.member_first_booking_none_body()}</p>
			<div class="mt-3">
				<Button href={resolve('member/reservations')} variant="default" size="sm">
					{m.member_book_session_label()}
				</Button>
			</div>
		{/if}
	</InfoCard>
{/if}
