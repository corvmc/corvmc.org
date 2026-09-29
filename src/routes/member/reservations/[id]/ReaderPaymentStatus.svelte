<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		cancelPayAtReader,
		getReaderPayment,
		simulatePayAtReader
	} from '$lib/remote/reservations.remote';

	/**
	 * After the amount is on the reader: the webhook settles the booking, so poll
	 * for it, bounded as the door screen does. Nothing here tells the server a
	 * payment succeeded; `paid` is read back from the booking.
	 */
	let {
		reservationId,
		paymentIntentId,
		canSimulate,
		onretry,
		onpaid,
		oncancelled
	}: {
		reservationId: string;
		paymentIntentId: string;
		canSimulate: boolean;
		onretry: () => Promise<void>;
		onpaid: () => void;
		oncancelled: () => void;
	} = $props();

	const RETRY_LIMIT = 30;
	const RETRY_MS = 2000;
	let attempts = $state(0);
	let busy = $state(false);
	const ref = $derived({ reservationId, paymentIntentId });
	const payment = $derived(await getReaderPayment(ref));

	const polling = $derived(payment.status === 'waiting' || payment.status === 'processing');

	$effect(() => {
		if (payment.status === 'paid') onpaid();
		else if (payment.status === 'cancelled') oncancelled();
	});

	$effect(() => {
		if (!polling || attempts >= RETRY_LIMIT) return;
		const timer = setTimeout(() => {
			attempts += 1;
			getReaderPayment(ref).refresh();
		}, RETRY_MS);
		return () => clearTimeout(timer);
	});

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		try {
			await fn();
			attempts = 0;
			await getReaderPayment(ref).refresh();
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-3" aria-live="polite">
	{#if payment.status === 'processing' || payment.status === 'paid'}
		<Alert>Card accepted. Confirming your booking…</Alert>
	{:else if payment.status === 'declined'}
		<Alert type="warning">{payment.message}. Try again with the same or another card.</Alert>
	{:else if attempts >= RETRY_LIMIT}
		<Alert type="warning">Still waiting for a card on the reader.</Alert>
	{:else if payment.status === 'waiting'}
		<Alert>Tap your card on the reader by the door.</Alert>
	{/if}

	{#if payment.status === 'waiting' || payment.status === 'declined'}
		<div class="flex flex-wrap gap-2">
			{#if payment.status === 'declined' || attempts >= RETRY_LIMIT}
				<Button variant="primary" disabled={busy} onclick={() => run(onretry)}>Try again</Button>
			{/if}
			{#if canSimulate && payment.status === 'waiting'}
				<Button
					variant="primary"
					outline
					disabled={busy}
					onclick={() => run(() => simulatePayAtReader({ ...ref, outcome: 'succeed' }))}
				>
					Simulate a tap
				</Button>
				<Button
					variant="warning"
					outline
					disabled={busy}
					onclick={() => run(() => simulatePayAtReader({ ...ref, outcome: 'decline' }))}
				>
					Simulate a decline
				</Button>
			{/if}
			<Button variant="ghost" disabled={busy} onclick={() => run(() => cancelPayAtReader(ref))}>
				Cancel
			</Button>
		</div>
	{/if}
</div>
