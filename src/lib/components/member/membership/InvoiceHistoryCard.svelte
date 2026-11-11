<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { IconReceipt, IconFileDownload } from '@tabler/icons-svelte';
	import { formatCents, formatMonthDayYear } from '#lib/utils/format.js';
	import type { BillingInvoice } from '#lib/server/finance/billing-service.js';

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
		paid: { label: m.member_membership_invoice_history_card_paid_label(), variant: 'success' },
		open: { label: m.member_membership_invoice_history_card_due_label(), variant: 'warning' },
		void: { label: m.member_membership_invoice_history_card_voided_label(), variant: 'error' },
		uncollectible: {
			label: m.member_membership_invoice_history_card_unpaid_label(),
			variant: 'error'
		}
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
					{m.member_membership_invoice_history_card_billing_history_title()}
				</h3>
				<p class="text-muted">
					{m.member_membership_invoice_history_card_every_receipt_with_pd_text()}
				</p>
			</div>
		</div>

		{#if !available}
			<div class="mt-4">
				<Alert type="warning">
					{m.member_membership_invoice_history_card_we_couldn_t_reach_our_body()}
				</Alert>
			</div>
		{:else if invoices.length === 0}
			<p class="mt-4 text-muted">
				{m.member_membership_invoice_history_card_nothing_billed_yet_text()}
			</p>
		{:else}
			<div class="mt-4 overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>{m.member_membership_invoice_history_card_date_label()}</th>
							<th>{m.member_membership_invoice_history_card_amount_label()}</th>
							<th>{m.member_membership_invoice_history_card_status_label()}</th>
							<th
								><span class="sr-only"
									>{m.member_membership_invoice_history_card_receipt_label()}</span
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
												>{m.member_membership_invoice_history_card_receipt_label()}</Button
											>
										{/if}
										{#if invoice.pdfUrl}
											<Button href={invoice.pdfUrl} variant="ghost" size="sm">
												<IconFileDownload size={16} />
												<span class="sr-only"
													>{m.member_membership_invoice_history_card_download_pdf_label({
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
