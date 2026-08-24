<script lang="ts">
	import { getReservationPolicy } from '$lib/remote/reservations.remote';

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
					<div class="skeleton mx-auto mt-1 h-6 w-16"></div>
				</div>
			{/each}
		</div>
	{:then policy}
		<div class="grid grid-cols-2 divide-x divide-base-300 sm:grid-cols-4">
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60">Rate</span>
				<span class="block text-lg font-bold">{fmtRate(policy.hourlyRateCents)}</span>
			</div>
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60">Hours</span>
				<span class="block text-lg font-bold"
					>{fmtHour(policy.operatingHoursStart)} – {fmtHour(policy.operatingHoursEnd)}</span
				>
			</div>
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60">Length</span>
				<span class="block text-lg font-bold"
					>{policy.minDurationHours} – {policy.maxDurationHours} hrs</span
				>
			</div>
			<div class="px-4 py-3 text-center">
				<span class="block text-[.6rem] font-bold tracking-wide uppercase opacity-60">Notice</span>
				<span class="block text-lg font-bold">{fmtNotice(policy.minAdvanceMinutes)}</span>
			</div>
		</div>
	{/await}
	<details class="border-t-[2.5px] border-base-300">
		<summary
			class="cursor-pointer px-4 py-2 text-subtle font-semibold tracking-wide uppercase hover:opacity-100"
		>
			Booking Policy
		</summary>
		<div class="space-y-1 px-4 pb-3 text-muted">
			<p>Payment is due at reservation start time via cash in person or card online.</p>
			<p>If you have specific needs for equipment or space, note them in the reservation form.</p>
		</div>
	</details>
</div>
