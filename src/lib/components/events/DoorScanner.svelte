<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The door queue, at door-queue speed (#933), for staff and for the door
	 * volunteer (#2795). The page passes the check-in call, so each keeps its own
	 * guard. **Offline is normal at a venue**, so a scan matches against the
	 * tickets the page already has and queues if the request fails.
	 *
	 * The camera stays open between tickets (#2796); each result names its code.
	 */
	import BarcodeScanner from '#lib/components/ui/BarcodeScanner.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { formatDateShort, formatTime } from '#lib/utils/format.js';

	type CheckInResult = { alreadyIn: boolean; checkedInAt: Date };

	let {
		tickets,
		checkIn,
		identify
	}: {
		tickets: {
			id: string;
			code: string;
			attendeeName: string;
			status: string;
			cancelledAt?: Date | null;
		}[];
		checkIn: (ticketId: string) => Promise<CheckInResult>;
		/** The other show a code is for, when it is not on this list (#2797). */
		identify: (code: string) => Promise<{ eventTitle: string; startsAt: Date } | null>;
	} = $props();

	type Outcome = { tone: 'success' | 'warning' | 'error'; code: string; text: string };

	let last = $state<Outcome | null>(null);
	/** Check-ins the door made that the server has not taken yet. */
	let pending = $state<{ ticketId: string; name: string }[]>([]);
	let draining = $state(false);

	const byCode = $derived(new Map(tickets.map((t) => [t.code.toLowerCase(), t])));

	async function send(ticketId: string, name: string, code: string) {
		const result = await checkIn(ticketId);
		last = result.alreadyIn
			? {
					tone: 'warning',
					code,
					text: `${name} was already in at ${formatTime(result.checkedInAt)}`
				}
			: { tone: 'success', code, text: `${name} is in` };
	}

	async function miss(code: string) {
		const unknown: Outcome = {
			tone: 'error',
			code,
			text: 'No ticket on this show matches that code'
		};
		last = unknown;
		try {
			const other = await identify(code);
			if (other && last === unknown) {
				last = {
					tone: 'error',
					code,
					text: m.events_door_scanner_other_show_body({
						title: other.eventTitle,
						date: formatDateShort(other.startsAt)
					})
				};
			}
		} catch {
			// Offline: the plain miss stands.
		}
	}

	async function onscan(raw: string) {
		const code = raw.trim();
		const ticket = byCode.get(code.toLowerCase());
		if (!ticket) return miss(code);

		if (ticket.status === 'cancelled') {
			last = {
				tone: 'error',
				code: ticket.code,
				text: m.events_door_scanner_cancelled_body({
					name: ticket.attendeeName,
					date: ticket.cancelledAt ? formatDateShort(ticket.cancelledAt) : ''
				})
			};
			return;
		}

		try {
			await send(ticket.id, ticket.attendeeName, ticket.code);
		} catch {
			// Held rather than lost. The scan already matched a real ticket on
			// this show, so the door has enough to let them in and reconcile.
			pending = [...pending, { ticketId: ticket.id, name: ticket.attendeeName }];
			last = {
				tone: 'warning',
				code: ticket.code,
				text: `${ticket.attendeeName} is in — waiting to sync`
			};
		}
	}

	async function drain() {
		draining = true;
		const queue = pending;
		pending = [];
		for (const item of queue) {
			try {
				await checkIn(item.ticketId);
			} catch {
				pending = [...pending, item];
			}
		}
		draining = false;
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2">
		<!-- A closed camera clears the result, so the next person never reads the last one's. -->
		<BarcodeScanner
			{onscan}
			onstop={() => (last = null)}
			continuous
			label={m.staff_events_id_check_in_door_scanner_label()}
		/>
		<span class="text-subtle text-sm"
			>{m.staff_events_id_check_in_door_scanner_find_them_by_name_belo_text()}</span
		>
	</div>

	{#if last}
		<div data-testid="scan-result" data-code={last.code}>
			<Alert type={last.tone}>
				<span class="font-mono">{last.code}</span> · {last.text}
			</Alert>
		</div>
	{/if}

	{#if pending.length > 0}
		<!-- Named rather than counted: "3 waiting" tells a door volunteer nothing
		     they can act on, and the names are who to look for if one fails. -->
		<Alert type="warning">
			{#snippet action()}
				<Button size="sm" onclick={drain} disabled={draining}>
					{draining
						? m.staff_events_id_check_in_door_scanner_syncing_label()
						: m.staff_events_id_check_in_door_scanner_sync_now_label()}
				</Button>
			{/snippet}
			{m.staff_events_id_check_in_door_scanner_waiting_sync_body({
				join: pending.map((p) => p.name).join(', ')
			})}
		</Alert>
	{/if}
</div>
