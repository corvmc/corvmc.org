<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { getReservationPolicy } from '#lib/remote/reservations.remote.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';

	/** "09:00" → "9 AM", "21:30" → "9:30 PM" */
	function fmtHour(hhmm: string): string {
		const [h, m] = hhmm.split(':').map(Number);
		const suffix = h >= 12 ? 'PM' : 'AM';
		const hour12 = h % 12 === 0 ? 12 : h % 12;
		return m > 0 ? `${hour12}:${String(m).padStart(2, '0')} ${suffix}` : `${hour12} ${suffix}`;
	}

	/** Minimum-notice label: 30 → "30 min+", 60 → "1 hr+", 1440 → "1 day+" */
	function fmtNotice(minutes: number): string {
		if (minutes >= 1440 && minutes % 1440 === 0) {
			const days = minutes / 1440;
			return `${days} day${days === 1 ? '' : 's'}+`;
		}
		if (minutes >= 60 && minutes % 60 === 0) {
			const hrs = minutes / 60;
			return `${hrs} hr${hrs === 1 ? '' : 's'}+`;
		}
		return `${minutes} min+`;
	}

	function fmtRate(cents: number): string {
		const dollars = cents / 100;
		return Number.isInteger(dollars) ? `$${dollars}/hr` : `$${dollars.toFixed(2)}/hr`;
	}
</script>

<div class="overflow-hidden rounded-lg border-[2.5px] border-base-300 bg-base-200">
	{#await getReservationPolicy()}
		<div class="grid grid-cols-2 divide-x divide-base-300 sm:grid-cols-4">
			{#each ['Rate', 'Hours', 'Length', 'Notice'] as label (label)}
				<div class="px-4 py-3 text-center">
					<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60"
						>{label}</span
					>
					<div class="mx-auto mt-1 h-6 w-16 skeleton"></div>
				</div>
			{/each}
		</div>
	{:then policy}
		<div class="grid grid-cols-2 divide-x divide-base-300 sm:grid-cols-4">
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60"
					>{msg.reservations_booking_policy_rate()}</span
				>
				<span class="block text-lg font-bold">{fmtRate(policy.hourlyRateCents)}</span>
			</div>
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60"
					>{msg.reservations_booking_policy_hours()}</span
				>
				<span class="block text-lg font-bold"
					>{fmtHour(policy.operatingHoursStart)} – {fmtHour(policy.operatingHoursEnd)}</span
				>
			</div>
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60"
					>{msg.reservations_booking_policy_length()}</span
				>
				<span class="block text-lg font-bold"
					>{msg.reservations_booking_policy_hrs({
						minDurationHours: policy.minDurationHours,
						maxDurationHours: policy.maxDurationHours
					})}</span
				>
			</div>
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60"
					>{msg.reservations_booking_policy_notice()}</span
				>
				<span class="block text-lg font-bold">{fmtNotice(policy.minAdvanceMinutes)}</span>
			</div>
		</div>
	{:catch error}
		<Alert type="error">{msg.ui_load_failed({ error: errorMessage(error) })}</Alert>
	{/await}
	<details class="border-t-[2.5px] border-base-300">
		<summary
			class="cursor-pointer px-4 py-2 text-subtle font-semibold tracking-wide uppercase hover:opacity-100"
		>
			{msg.reservations_booking_policy_booking_policy()}
		</summary>
		<div class="space-y-1 px-4 pb-3 text-muted">
			<p>{msg.reservations_booking_policy_payment_due_at_reservation_start()}</p>
			<p>{msg.reservations_booking_policy_if_have_specific_needs_equipment()}</p>
		</div>
	</details>
</div>
