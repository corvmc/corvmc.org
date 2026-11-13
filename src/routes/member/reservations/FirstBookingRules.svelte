<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';

	// Both from the server's notice for this member; the tour is 0 while no
	// orientation role is set, and then nobody runs one.
	let { noticeMinutes, tourMinutes }: { noticeMinutes: number; tourMinutes: number } = $props();
</script>

<section
	class="rounded-lg border-[2.5px] border-base-300 px-4 py-3"
	aria-labelledby="first-booking-rules"
	data-testid="first-booking-rules"
>
	<h2 id="first-booking-rules" class="font-semibold">
		{m.member_reservations_first_booking_title()}
	</h2>
	<ul class="mt-1 list-disc space-y-0.5 pl-5 text-muted">
		<li>
			{m.member_reservations_first_booking_notice_text({ days: Math.ceil(noticeMinutes / 1440) })}
		</li>
		{#if tourMinutes > 0}
			<li>{m.member_reservations_first_booking_tour_text({ minutes: tourMinutes })}</li>
			<li>{m.member_reservations_first_booking_after_tour_text()}</li>
		{/if}
	</ul>
</section>
