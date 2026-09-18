<script lang="ts">
	/**
	 * The door queue, at door-queue speed (#933).
	 *
	 * `BarcodeScanner`, `TicketQRModal`'s QR and an idempotent `checkIn` all
	 * existed; this wires them together. **Offline is normal at a venue**, so
	 * a scan matches against the tickets the page already has and queues if
	 * the request fails.
	 */
	import BarcodeScanner from '$lib/components/ui/BarcodeScanner.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { formatTime } from '$lib/utils/format';
	import { scanTicketIn } from '$lib/remote/events.remote';

	let {
		tickets,
		eventId
	}: {
		tickets: { id: string; code: string; attendeeName: string; status: string }[];
		eventId: string;
	} = $props();

	type Outcome = { tone: 'success' | 'warning' | 'error'; text: string };

	let last = $state<Outcome | null>(null);
	/** Check-ins the door made that the server has not taken yet. */
	let pending = $state<{ ticketId: string; name: string }[]>([]);
	let draining = $state(false);

	const byCode = $derived(new Map(tickets.map((t) => [t.code.toLowerCase(), t])));

	async function send(ticketId: string, name: string) {
		const result = await scanTicketIn({ ticketId, eventId });
		last = result.alreadyIn
			? { tone: 'warning', text: `${name} was already in at ${formatTime(result.checkedInAt)}` }
			: { tone: 'success', text: `${name} is in` };
	}

	async function onscan(raw: string) {
		const ticket = byCode.get(raw.trim().toLowerCase());
		if (!ticket) {
			last = { tone: 'error', text: 'No ticket on this show matches that code' };
			return;
		}

		try {
			await send(ticket.id, ticket.attendeeName);
		} catch {
			// Held rather than lost. The scan already matched a real ticket on
			// this show, so the door has enough to let them in and reconcile.
			pending = [...pending, { ticketId: ticket.id, name: ticket.attendeeName }];
			last = { tone: 'warning', text: `${ticket.attendeeName} is in — waiting to sync` };
		}
	}

	async function drain() {
		draining = true;
		const queue = pending;
		pending = [];
		for (const item of queue) {
			try {
				await send(item.ticketId, item.name);
			} catch {
				pending = [...pending, item];
			}
		}
		draining = false;
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2">
		<BarcodeScanner {onscan} label="Scan tickets" />
		<span class="text-subtle text-sm">Or find them by name below.</span>
	</div>

	{#if last}
		<Alert type={last.tone}>{last.text}</Alert>
	{/if}

	{#if pending.length > 0}
		<!-- Named rather than counted: "3 waiting" tells a door volunteer nothing
		     they can act on, and the names are who to look for if one fails. -->
		<Alert type="warning">
			{#snippet action()}
				<Button size="sm" onclick={drain} disabled={draining}>
					{draining ? 'Syncing…' : 'Sync now'}
				</Button>
			{/snippet}
			Waiting to sync: {pending.map((p) => p.name).join(', ')}
		</Alert>
	{/if}
</div>
