<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Turnstile } from 'svelte-turnstile';
	import type { RemoteFormIssue } from '@sveltejs/kit';
	import { MARKET_MAX_TABLES_REQUESTED, pageTitle } from '$lib/config';
	import {
		TURNSTILE_SITE_KEY,
		TURNSTILE_RESPONSE_FIELD,
		turnstileFailureMessage
	} from '$lib/turnstile';
	import { formatDateTime, fullDate } from '$lib/utils/format';
	import { getVendorApplyPage, submitVendorApplicationForm } from '$lib/remote/market.remote';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	/**
	 * A vendor's application for a table at a market day. No account needed:
	 * the application opens an inbox thread, and staff answer it by email.
	 */
	const fields = submitVendorApplicationForm.fields;

	let submitted = $state(false);
	let failure = $state<string | null>(null);
	let resetTurnstile = $state<() => void>();

	const market = $derived(await getVendorApplyPage(page.params.id!));
</script>

<svelte:head>
	<title>{pageTitle(`Apply to vend — ${market.title}`)}</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-12">
	<p class="eyebrow mb-2">Vendor application</p>
	<h1 class="mb-2 text-3xl font-bold">{market.title}</h1>
	<p class="mb-8 text-muted">{fullDate(market.startsAt)}</p>

	{#if submitted}
		<Alert type="success">
			Thanks — your application is in. We'll reply by email once it has been reviewed.
		</Alert>
	{:else if !market.accepting}
		<Alert type="info">Applications for this market are closed.</Alert>
		<Button href={resolve(`/events/${market.eventId}`)} variant="ghost" class="mt-4">
			Back to the event
		</Button>
	{:else}
		{#if market.closesAt}
			<p class="mb-4">Applications close {formatDateTime(market.closesAt)}.</p>
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
				<FormField field={fields.contactName} type="text" label="Your name" required />
				<FormField field={fields.contactEmail} type="email" label="Email" required />
				<FormField field={fields.contactPhone} type="tel" label="Phone (optional)" />
				<FormField field={fields.businessName} type="text" label="Business name" required />
			</div>

			<FormField name="offering" label="What do you sell?">
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
				label="Website or shop link (optional)"
				placeholder="https://"
			/>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField
					field={fields.tablesRequested}
					type="number"
					label="Tables needed"
					value={1}
					min="1"
					max={MARKET_MAX_TABLES_REQUESTED}
					description={`Up to ${MARKET_MAX_TABLES_REQUESTED}.`}
				/>
				<FormField
					field={fields.needsPower}
					type="checkbox"
					label="Power"
					checkboxLabel="I need an outlet"
				/>
			</div>

			<FormField name="notes" label="Anything else? (optional)">
				<textarea {...fields.notes.as('text')} class="textarea w-full" rows="3" maxlength="2000"
				></textarea>
			</FormField>

			<p class="text-muted text-sm">
				If you are accepted, your business name, what you sell and your website are listed on the
				event page. Your name, email and phone are never published.
			</p>

			<Turnstile
				siteKey={TURNSTILE_SITE_KEY}
				responseFieldName={TURNSTILE_RESPONSE_FIELD}
				theme="auto"
				bind:reset={resetTurnstile}
			/>
			{#if failure}
				<Alert type="error">{failure}</Alert>
			{/if}
			<SubmitButton label="Send application" />
		</Form>
	{/if}
</div>
