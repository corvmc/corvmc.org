<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { IconReceipt, IconFileDownload } from '@tabler/icons-svelte';
	import { formatCents, formatMonthDayYear } from '$lib/utils/format';
	import type { BillingInvoice } from '$lib/server/finance/billing-service';

	let {
		invoices,
		available
	}: {
		invoices: BillingInvoice[];
		/** False when Stripe could not be reached — the history is unknown, not empty. */
		available: boolean;
	} = $props();

	// Stripe's statuses, in this app's vocabulary. `void` and `uncollectible` are
	// rare but real, and reading a raw Stripe enum on a member's page is worse
	// than a word for it.
	const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'error' }> = {
		paid: { label: m.member_membership_invoice_history_card_paid(), variant: 'success' },
		open: { label: m.member_membership_invoice_history_card_due(), variant: 'warning' },
		void: { label: m.member_membership_invoice_history_card_voided(), variant: 'error' },
		uncollectible: { label: m.member_membership_invoice_history_card_unpaid(), variant: 'error' }
	};

	const date = formatMonthDayYear;
</script>

<Card testid="billing-history">
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconReceipt size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">
					{m.member_membership_invoice_history_card_billing_history()}
				</h3>
				<p class="text-muted">{m.member_membership_invoice_history_card_every_receipt_with_pd()}</p>
			</div>
		</div>

		{#if !available}
			<div class="mt-4">
				<Alert type="warning">
					{m.member_membership_invoice_history_card_we_couldn_t_reach_our()}
				</Alert>
			</div>
		{:else if invoices.length === 0}
			<p class="mt-4 text-muted">{m.member_membership_invoice_history_card_nothing_billed_yet()}</p>
		{:else}
			<div class="mt-4 overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>{m.member_membership_invoice_history_card_date()}</th>
							<th>{m.member_membership_invoice_history_card_amount()}</th>
							<th>{m.member_membership_invoice_history_card_status()}</th>
							<th
								><span class="sr-only">{m.member_membership_invoice_history_card_receipt()}</span
								></th
							>
						</tr>
					</thead>
					<tbody>
						{#each invoices as invoice (invoice.id)}
							{@const status = STATUS[invoice.status] ?? {
								label: invoice.status,
								variant: 'warning' as const
							}}
							<tr>
								<td>{date(invoice.created)}</td>
								<td class="tabular-nums">{formatCents(invoice.amountPaidCents)}</td>
								<td><Badge variant={status.variant}>{status.label}</Badge></td>
								<td class="text-right">
									<div class="flex w-max justify-end gap-1">
										{#if invoice.hostedUrl}
											<Button href={invoice.hostedUrl} variant="ghost" size="sm"
												>{m.member_membership_invoice_history_card_receipt()}</Button
											>
										{/if}
										{#if invoice.pdfUrl}
											<Button href={invoice.pdfUrl} variant="ghost" size="sm">
												<IconFileDownload size={16} />
												<span class="sr-only"
													>{m.member_membership_invoice_history_card_download_pdf({
														date: date(invoice.created)
													})}</span
												>
											</Button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</CardBody>
</Card>
