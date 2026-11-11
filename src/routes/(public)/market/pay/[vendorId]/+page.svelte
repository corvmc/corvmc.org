<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { pageTitle } from '#lib/config.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { formatCents, formatDateTime } from '#lib/utils/format.js';
	import { goToCheckout } from '#lib/utils/checkout-navigation.js';
	import { getVendorFeePage, payVendorFeeForm } from '#lib/remote/market.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('vendorId');

	/**
	 * Where an accepted market vendor pays their table fee (#1502). Linked from
	 * the acceptance message; the vendor has no account, so the id is the key.
	 * On a sliding scale the vendor names the amount, from the floor to the fee.
	 */
	const fields = payVendorFeeForm.fields;

	const vendorId = $derived(params.vendorId);
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
		<p class="eyebrow mb-2">{m.public_market_pay_vendor_id_market_vendor_text()}</p>
		<h1 class="text-3xl font-bold">{fee.businessName}</h1>
		<p class="text-muted">{fee.marketTitle} · {formatDateTime(fee.startsAt)}</p>
	</div>

	{#if fee.refunded}
		<Alert>{m.public_market_pay_vendor_id_table_fee_was_refunded_body()}</Alert>
	{:else if fee.paidCents !== null}
		<Alert type="success">
			{m.public_market_pay_vendor_id_paid_thank_see_at_market_body({
				formatCents: formatCents(fee.paidCents)
			})}
		</Alert>
	{:else if returned}
		<Alert>{m.public_market_pay_vendor_id_payment_being_confirmed_page_wil_body()}</Alert>
	{:else if !fee.due}
		<Alert>{m.public_market_pay_vendor_id_there_no_table_fee_pay_body()}</Alert>
	{:else}
		<Form remote={payVendorFeeForm} {onsuccess} class="space-y-4">
			<input {...fields.vendorId.as('hidden', fee.vendorId)} />
			{#if fee.slidingScale}
				<p>
					{m.public_market_pay_vendor_id_market_runs_sliding_scale_table_text({
						formatCents: formatCents(fee.feeCents),
						formatCents2: formatCents(fee.floorCents)
					})}
				</p>
				<MoneyField
					field={fields.amountCents}
					label={m.public_market_pay_vendor_id_amount_label()}
					value={fee.feeCents}
				/>
			{:else}
				<p>
					{m.public_market_pay_vendor_id_table_fee_text({ formatCents: formatCents(fee.feeCents) })}
				</p>
			{/if}
			<SubmitButton label={m.public_market_pay_vendor_id_pay_table_fee_label()} />
		</Form>
	{/if}
</div>
