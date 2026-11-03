<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { fullDate } from '$lib/utils/format';
	import { IconCircleCheck } from '@tabler/icons-svelte';
	import { getTicketPurchaseSuccess } from '$lib/remote/events.remote';
	import { page } from '$app/state';
	import { formatEventTimeRange } from '$lib/utils/event-time';

	const purchaseId = page.url.searchParams.get('purchase_id') ?? '';
	let data = $derived(await getTicketPurchaseSuccess({ eventId: page.params.id!, purchaseId }));

	const evt = $derived(data.event);
	// Free claims keep the historic `rsvp-` purchase prefix; they're still tickets.
	const isFreeClaim = $derived(purchaseId.startsWith('rsvp-'));

	// Tickets go `valid` on the webhook, not on payment. Paying on Stripe's page
	// the redirect took long enough that it had always landed; paying on ours the
	// buyer arrives in the same second and would read unpaid codes.
	//
	// So poll, briefly. `attempts` bounds it: a webhook twenty seconds late is not
	// going to be waited out, and the codes below are already correct either way —
	// only the claim that they are paid for has to wait.
	const pending = $derived(data.tickets.some((t) => t.status === 'pending'));
	let attempts = $state(0);
	const RETRY_LIMIT = 10;
	const RETRY_MS = 2000;

	$effect(() => {
		if (!pending || attempts >= RETRY_LIMIT) return;

		const timer = setTimeout(() => {
			attempts += 1;
			getTicketPurchaseSuccess({ eventId: page.params.id!, purchaseId }).refresh();
		}, RETRY_MS);

		return () => clearTimeout(timer);
	});
</script>

<div class="mx-auto max-w-lg space-y-6">
	<PageHeader
		title={m.public_events_id_tickets_success_title()}
		parent={[
			{ label: m.public_events(), href: resolve('/events') },
			{ label: evt.title, href: resolve(`/events/${page.params.id!}`) }
		]}
	/>

	<Card>
		<CardBody class="space-y-4 text-center">
			<div class="flex justify-center">
				<IconCircleCheck size={64} class="text-success" />
			</div>

			<div>
				<h2 class="text-xl font-bold">{evt.title}</h2>
				<p class="mt-1 opacity-70">
					{fullDate(evt.startsAt)} · {formatEventTimeRange(evt.startsAt, evt.endsAt)}
				</p>
			</div>

			<!-- Only paid purchases trigger an email (ticket.purchased fires from the
			     Stripe webhook). Free claims send nothing, so don't promise one. -->
			<p class="text-muted">
				{#if isFreeClaim}
					{m.public_events_id_tickets_success_save_codes_below_s_confirma({
						count: data.tickets.length
					})}
				{:else}
					{m.public_events_id_tickets_success_confirmation_email_receipt({
						value: data.tickets[0]?.attendeeEmail ?? m.public_events_id_tickets_success_email()
					})}
				{/if}
			</p>
		</CardBody>
	</Card>

	{#if pending}
		<Alert type="info">
			{attempts >= RETRY_LIMIT
				? m.public_events_id_tickets_success_we_haven_t_had_confirmation()
				: m.public_events_id_tickets_success_confirming_payment()}
		</Alert>
	{/if}

	<!-- Ticket codes -->
	<Card>
		<CardBody>
			<h3 class="mb-3 font-medium">{m.public_events_id_tickets_success_tickets()}</h3>
			<div class="space-y-3">
				{#each data.tickets as ticket (ticket.id)}
					<div class="flex items-center justify-between inset p-3">
						<div>
							<p class="font-medium">{ticket.attendeeName}</p>
							<p class="text-muted">{ticket.attendeeEmail}</p>
						</div>
						<div class="text-right">
							<p class="font-mono text-lg font-bold tracking-wider" data-testid="ticket-code">
								{ticket.code}
							</p>
							<p class="text-subtle">{m.public_events_id_tickets_success_ticket_code()}</p>
						</div>
					</div>
				{/each}
			</div>
		</CardBody>
	</Card>

	<div class="text-center">
		<Button href="/events" variant="ghost"
			>{m.public_events_id_tickets_success_back_events()}</Button
		>
	</div>
</div>
