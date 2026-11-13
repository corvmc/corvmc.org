<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { formatCents, formatDateShortYear, formatTimeRange } from '#lib/utils/format.js';

	interface Fee {
		id: string;
		startsAt: Date;
		endsAt: Date;
		amountCents: number | null;
	}

	/**
	 * What the booking form says about outstanding fees (#2748). The server makes
	 * the same count and refuses on its own; this only says why. `staff` links
	 * each fee to the staff record instead of the member's pay page.
	 */
	let {
		gate,
		staff = false
	}: {
		gate: { state: 'off' | 'clear' | 'warn' | 'refuse'; fees: Fee[] };
		staff?: boolean;
	} = $props();

	const href = (id: string) =>
		staff
			? resolve('/staff/reservations/[id]', { id })
			: resolve('/member/reservations/[id]/pay', { id });

	const one = $derived(gate.state === 'warn' && !staff ? gate.fees[0] : null);
</script>

{#if one}
	<Alert type="warning" class="mb-3">
		{#if one.amountCents != null}
			{m.reservations_booking_fee_notice_one_fee_body({
				date: formatDateShortYear(one.startsAt),
				amount: formatCents(one.amountCents)
			})}
		{:else}
			{m.reservations_booking_fee_notice_one_unpriced_fee_body({
				date: formatDateShortYear(one.startsAt)
			})}
		{/if}
		{#snippet action()}
			<Button href={href(one.id)} size="xs" variant="primary" outline>
				{m.reservations_booking_fee_notice_pay_label()}
			</Button>
		{/snippet}
	</Alert>
{:else if gate.state === 'refuse' || (staff && gate.state === 'warn')}
	<div class="mb-3 space-y-2" data-testid="fee-notice">
		<Alert type={staff ? 'warning' : 'error'}>
			{staff
				? m.reservations_booking_fee_notice_staff_body()
				: m.reservations_booking_fee_notice_refused_body()}
		</Alert>
		<ul class="divide-y divide-base-200">
			{#each gate.fees as fee (fee.id)}
				<li class="flex items-center justify-between gap-2 py-2">
					<span>
						<span class="block font-medium">{formatDateShortYear(fee.startsAt)}</span>
						<span class="block text-muted">{formatTimeRange(fee.startsAt, fee.endsAt)}</span>
					</span>
					<span class="ml-auto tabular-nums">
						{fee.amountCents != null ? formatCents(fee.amountCents) : ''}
					</span>
					<Button href={href(fee.id)} size="xs" variant="primary" outline>
						{staff
							? m.reservations_booking_fee_notice_view_label()
							: m.reservations_booking_fee_notice_pay_label()}
					</Button>
				</li>
			{/each}
		</ul>
	</div>
{/if}
