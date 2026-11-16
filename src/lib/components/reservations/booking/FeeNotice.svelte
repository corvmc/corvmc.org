<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { formatCents, formatDateShortYear, formatTimeRange } from '#lib/utils/format.js';
	import type { FeeGate } from './PaymentDue.svelte';

	/**
	 * What the staff booking form says about a member's outstanding fees (#2748).
	 * Staff are never refused; a member's own booking button is `PaymentDue`.
	 */
	let { gate }: { gate: FeeGate } = $props();
</script>

{#if gate.fees.length > 0}
	<div class="mb-3 space-y-2" data-testid="fee-notice">
		<Alert type="warning">{m.reservations_booking_fee_notice_staff_body()}</Alert>
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
					<Button
						href={resolve('/staff/reservations/[id]', { id: fee.id })}
						size="xs"
						variant="primary"
						outline
					>
						{m.reservations_booking_fee_notice_view_label()}
					</Button>
				</li>
			{/each}
		</ul>
	</div>
{/if}
