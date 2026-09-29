<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { payAtReader } from '$lib/remote/reservations.remote';
	import ReaderPaymentStatus from './ReaderPaymentStatus.svelte';

	/**
	 * "Pay at the reader": the server decides the amount and puts it on the
	 * reader by the door. Shown only when a reader is configured and the booking
	 * owes money today, which the detail query has already worked out.
	 */
	let {
		reservationId,
		canSimulate,
		onpaid
	}: { reservationId: string; canSimulate: boolean; onpaid: () => void } = $props();

	let paymentIntentId = $state<string | null>(null);
	let busy = $state(false);
	let failure = $state<string | null>(null);

	async function start() {
		busy = true;
		failure = null;
		try {
			const result = await payAtReader(reservationId);
			if (result.settled) {
				paymentIntentId = null;
				onpaid();
			} else {
				paymentIntentId = result.paymentIntentId;
			}
		} catch (err) {
			failure = (err as { body?: { message?: string } }).body?.message ?? 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	function paid() {
		paymentIntentId = null;
		onpaid();
	}
</script>

{#if paymentIntentId}
	<ReaderPaymentStatus
		{reservationId}
		{paymentIntentId}
		{canSimulate}
		onretry={start}
		onpaid={paid}
		oncancelled={() => (paymentIntentId = null)}
	/>
{:else}
	<div class="space-y-2">
		{#if failure}
			<Alert type="warning">{failure}</Alert>
		{/if}
		<Button variant="primary" outline class="w-full" disabled={busy} onclick={start}>
			Pay at the reader
		</Button>
	</div>
{/if}
