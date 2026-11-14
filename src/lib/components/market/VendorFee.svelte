<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { VendorFeeState } from '#lib/server/market/vendor-fee-service.js';
	import { formatCents } from '#lib/utils/format.js';

	/** A vendor's table fee as one short line: what is owed, paid or refunded. */
	let { fee, class: className = '' }: { fee: VendorFeeState; class?: string } = $props();
</script>

{#if fee.state === 'none'}
	<span class="text-muted {className}">—</span>
{:else if fee.state === 'refunded'}
	<span class={className}>{m.market_vendor_fee_refunded_text()}</span>
{:else if fee.state === 'paid'}
	<span class={className}>{m.market_vendor_fee_paid_text({ amount: formatCents(fee.cents) })}</span>
{:else}
	<span class="font-medium text-warning {className}"
		>{m.market_vendor_fee_due_text({ amount: formatCents(fee.cents) })}</span
	>
{/if}
