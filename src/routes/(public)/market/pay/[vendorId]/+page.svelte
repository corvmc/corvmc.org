<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
		<p class="eyebrow mb-2">{m.public_market_pay_vendor_id_market_vendor()}</p>
		<h1 class="text-3xl font-bold">{fee.businessName}</h1>
		<p class="text-muted">{fee.marketTitle} · {formatDateTime(fee.startsAt)}</p>
	</div>

	{#if fee.refunded}
		<Alert>{m.public_market_pay_vendor_id_table_fee_was_refunded()}</Alert>
	{:else if fee.paidCents !== null}
		<Alert type="success">
			{m.public_market_pay_vendor_id_paid_thank_see_at_market({
				formatCents: formatCents(fee.paidCents)
			})}
		</Alert>
	{:else if returned}
		<Alert>{m.public_market_pay_vendor_id_payment_being_confirmed_page_wil()}</Alert>
	{:else if !fee.due}
		<Alert>{m.public_market_pay_vendor_id_there_no_table_fee_pay()}</Alert>
	{:else}
		<Form remote={payVendorFeeForm} {onsuccess} class="space-y-4">
			<input {...fields.vendorId.as('hidden', fee.vendorId)} />
			{#if fee.slidingScale}
				<p>
					{m.public_market_pay_vendor_id_market_runs_sliding_scale_table({
						formatCents: formatCents(fee.feeCents),
						formatCents2: formatCents(fee.floorCents)
					})}
				</p>
				<MoneyField
					field={fields.amountCents}
					label={m.public_market_pay_vendor_id_amount()}
					value={fee.feeCents}
				/>
			{:else}
				<p>{m.public_market_pay_vendor_id_table_fee({ formatCents: formatCents(fee.feeCents) })}</p>
			{/if}
			<SubmitButton label={m.public_market_pay_vendor_id_pay_table_fee()} />
		</Form>
	{/if}
</div>
