<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import { formatDate, formatTime } from '$lib/utils/format';
	import QRCode from 'qrcode-svg';

	interface TicketData {
		code: string;
		attendeeName: string;
		event: { title: string; startsAt: Date; endsAt: Date } | null;
	}

	let {
		open = $bindable(false),
		tickets,
		initialIndex = 0
	}: {
		open?: boolean;
		tickets: TicketData[];
		initialIndex?: number;
	} = $props();

	let offset = $state(0);

	const index = $derived((initialIndex + offset + tickets.length) % tickets.length);
	const ticket = $derived(tickets[index]!);
	const total = $derived(tickets.length);
	const hasMultiple = $derived(total > 1);

	const qrSvg = $derived(
		new QRCode({
			content: ticket.code,
			width: 200,
			height: 200,
			padding: 0,
			ecl: 'M',
			join: true
		}).svg()
	);

	function handleClose() {
		offset = 0;
	}
</script>

<Modal bind:open title="Your Ticket" maxWidth="max-w-sm" onclose={handleClose}>
	<div class="flex flex-col items-center gap-4 py-2">
		{#if ticket.event}
			<div class="text-center">
				<p class="text-lg font-bold">{ticket.event.title}</p>
				<p class="text-muted">
					{formatDate(ticket.event.startsAt)} &middot; {formatTime(ticket.event.startsAt)}
				</p>
			</div>
		{/if}

		<div class="rounded-lg bg-white p-4">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (QR svg) -->
			{@html qrSvg}
		</div>

		<div class="text-center">
			<p class="font-mono text-lg tracking-widest">{ticket.code}</p>
			<p class="text-muted">{ticket.attendeeName}</p>
		</div>

		{#if hasMultiple}
			<div class="flex items-center gap-4">
				<Button
					type="button"
					variant="default"
					size="sm"
					shape="circle"
					outline
					aria-label="Previous ticket"
					onclick={() => (offset -= 1)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						style="width:16px;height:16px"><path d="M15 6l-6 6 6 6" /></svg
					>
				</Button>
				<span class="text-muted">{index + 1} of {total}</span>
				<Button
					type="button"
					variant="default"
					size="sm"
					shape="circle"
					outline
					aria-label="Next ticket"
					onclick={() => (offset += 1)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						style="width:16px;height:16px"><path d="M9 6l6 6-6 6" /></svg
					>
				</Button>
			</div>
		{/if}
	</div>
</Modal>
