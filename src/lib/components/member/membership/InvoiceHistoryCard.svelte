<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { IconReceipt, IconFileDownload } from '@tabler/icons-svelte';
	import { formatCents } from '$lib/utils/format';
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
		paid: { label: 'Paid', variant: 'success' },
		open: { label: 'Due', variant: 'warning' },
		void: { label: 'Voided', variant: 'error' },
		uncollectible: { label: 'Unpaid', variant: 'error' }
	};

	const date = (value: Date) =>
		value.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
</script>

<Card>
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconReceipt size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">Billing History</h3>
				<p class="text-muted">Every receipt, with the PDF</p>
			</div>
		</div>

		{#if !available}
			<div class="mt-4">
				<Alert type="warning">
					We couldn't reach our payment processor just now, so your history isn't shown. Try again
					in a moment.
				</Alert>
			</div>
		{:else if invoices.length === 0}
			<p class="mt-4 text-muted">Nothing billed yet.</p>
		{:else}
			<div class="mt-4 overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Amount</th>
							<th>Status</th>
							<th><span class="sr-only">Receipt</span></th>
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
									<div class="flex justify-end gap-1">
										{#if invoice.hostedUrl}
											<Button href={invoice.hostedUrl} variant="ghost" size="sm">Receipt</Button>
										{/if}
										{#if invoice.pdfUrl}
											<Button href={invoice.pdfUrl} variant="ghost" size="sm">
												<IconFileDownload size={16} />
												<span class="sr-only">Download PDF for {date(invoice.created)}</span>
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
