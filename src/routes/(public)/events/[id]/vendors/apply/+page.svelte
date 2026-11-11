<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { Turnstile } from 'svelte-turnstile';
	import type { RemoteFormIssue } from '$app/server';
	import { MARKET_MAX_TABLES_REQUESTED, pageTitle } from '#lib/config.js';
	import { TURNSTILE_SITE_KEY, turnstileFailureMessage } from '#lib/turnstile.js';
	import { formatDateTime, fullDate } from '#lib/utils/format.js';
	import { getVendorApplyPage, submitVendorApplicationForm } from '#lib/remote/market.remote.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/**
	 * A vendor's application for a table at a market day. No account needed:
	 * the application opens an inbox thread, and staff answer it by email.
	 */
	const fields = submitVendorApplicationForm.fields;

	let submitted = $state(false);
	let failure = $state<string | null>(null);
	let resetTurnstile = $state<() => void>();

	const market = $derived(await getVendorApplyPage(params.id));
</script>

<svelte:head>
	<title>{pageTitle(`Apply to vend — ${market.title}`)}</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-12">
	<p class="eyebrow mb-2">{m.public_events_id_vendors_apply_vendor_application_text()}</p>
	<h1 class="mb-2 text-3xl font-bold">{market.title}</h1>
	<p class="mb-8 text-muted">{fullDate(market.startsAt)}</p>

	{#if submitted}
		<Alert type="success">
			{m.public_events_id_vendors_apply_thanks_application_we_ll_repl_body()}
		</Alert>
	{:else if !market.accepting}
		<Alert type="info">{m.public_events_id_vendors_apply_applications_market_closed_body()}</Alert>
		<Button href={resolve(`events/${market.eventId}`)} variant="ghost" class="mt-4">
			{m.public_events_id_vendors_apply_back_event_label()}
		</Button>
	{:else}
		{#if market.closesAt}
			<p class="mb-4">
				{m.public_events_id_vendors_apply_applications_close_text({
					formatDateTime: formatDateTime(market.closesAt)
				})}
			</p>
		{/if}
		<Form
			remote={submitVendorApplicationForm}
			onsuccess={() => {
				submitted = true;
				failure = null;
			}}
			onfailure={(issues) => {
				resetTurnstile?.();
				failure = turnstileFailureMessage((issues as RemoteFormIssue[] | null) ?? null);
			}}
			class="flex flex-col gap-4"
		>
			<input {...fields.eventId.as('hidden', market.eventId)} />

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField
					field={fields.contactName}
					type="text"
					label={m.public_name_2_label()}
					required
				/>
				<FormField
					field={fields.contactEmail}
					type="email"
					label={m.public_email_label()}
					required
				/>
				<FormField
					field={fields.contactPhone}
					type="tel"
					label={m.public_events_id_vendors_apply_phone_optional_label()}
				/>
				<FormField
					field={fields.businessName}
					type="text"
					label={m.public_events_id_vendors_apply_business_name_label()}
					required
				/>
			</div>

			<FormField
				field={submitVendorApplicationForm.fields.offering}
				label={m.public_events_id_vendors_apply_what_do_sell_label()}
			>
				<textarea
					{...fields.offering.as('text')}
					class="textarea w-full"
					rows="3"
					maxlength="2000"
					required></textarea>
			</FormField>

			<FormField
				field={fields.website}
				type="text"
				label={m.public_events_id_vendors_apply_website_shop_link_optional_label()}
				placeholder={m.public_events_id_vendors_apply_placeholder()}
			/>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField
					field={fields.tablesRequested}
					type="number"
					label={m.public_events_id_vendors_apply_tables_needed_label()}
					value={1}
					min="1"
					max={MARKET_MAX_TABLES_REQUESTED}
					description={m.public_events_id_vendors_apply_description_body({
						MARKET_MAX_TABLES_REQUESTED
					})}
				/>
				<FormField
					field={fields.needsPower}
					type="checkbox"
					label={m.public_events_id_vendors_apply_power_label()}
					checkboxLabel={m.public_events_id_vendors_apply_checkbox_label_checkbox()}
				/>
			</div>

			<FormField
				field={submitVendorApplicationForm.fields.notes}
				label={m.public_events_id_vendors_apply_anything_else_optional_label()}
			>
				<textarea {...fields.notes.as('text')} class="textarea w-full" rows="3" maxlength="2000"
				></textarea>
			</FormField>

			<p class="text-muted text-sm">
				{m.public_events_id_vendors_apply_if_accepted_business_name_wha_text()}
			</p>

			<Turnstile
				siteKey={TURNSTILE_SITE_KEY}
				responseFieldName={fields.turnstileToken.as('hidden', '').name}
				theme="auto"
				bind:reset={resetTurnstile}
			/>
			{#if failure}
				<Alert type="error">{failure}</Alert>
			{/if}
			<SubmitButton label={m.public_events_id_vendors_apply_send_application_label()} />
		</Form>
	{/if}
</div>
