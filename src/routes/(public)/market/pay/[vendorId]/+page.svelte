<script lang="ts">
	import { page } from '$app/state';
	import { pageTitle } from '$lib/config';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import MoneyField from '$lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { formatCents, formatDateTime } from '$lib/utils/format';
	import { goToCheckout } from '$lib/utils/checkout-navigation';
	import { getVendorFeePage, payVendorFeeForm } from '$lib/remote/market.remote';

	/**
	 * Where an accepted market vendor pays their table fee (#1502). Linked from
	 * the acceptance message; the vendor has no account, so the id is the key.
	 * On a sliding scale the vendor names the amount, from the floor to the fee.
	 */
	const fields = payVendorFeeForm.fields;

	const vendorId = $derived(page.params.vendorId!);
	const returned = $derived(page.url.searchParams.get('paid') === '1');
	const fee = $derived(await getVendorFeePage(vendorId));

	async function onsuccess(result?: { redirectUrl: string }) {
		if (result?.redirectUrl) await goToCheckout(result.redirectUrl);
	}
</script>

<svelte:head>
	<title>{pageTitle('Table fee')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-xl space-y-6 px-4 py-12">
	<div>
		<p class="eyebrow mb-2">Market vendor</p>
		<h1 class="text-3xl font-bold">{fee.businessName}</h1>
		<p class="text-muted">{fee.marketTitle} · {formatDateTime(fee.startsAt)}</p>
	</div>

	{#if fee.refunded}
		<Alert>Your table fee was refunded.</Alert>
	{:else if fee.paidCents !== null}
		<Alert type="success">
			Paid {formatCents(fee.paidCents)}. Thank you — see you at the market.
		</Alert>
	{:else if returned}
		<Alert>Your payment is being confirmed. This page will show it as paid shortly.</Alert>
	{:else if !fee.due}
		<Alert>There is no table fee to pay for this application.</Alert>
	{:else}
		<Form remote={payVendorFeeForm} {onsuccess} class="space-y-4">
			<input {...fields.vendorId.as('hidden', fee.vendorId)} />
			{#if fee.slidingScale}
				<p>
					This market runs a sliding scale. The table fee is {formatCents(fee.feeCents)}; pay what
					you can, from {formatCents(fee.floorCents)} up.
				</p>
				<MoneyField field={fields.amountCents} label="Amount" value={fee.feeCents} />
			{:else}
				<p>Your table fee is {formatCents(fee.feeCents)}.</p>
			{/if}
			<SubmitButton label="Pay the table fee" />
		</Form>
	{/if}
</div>
