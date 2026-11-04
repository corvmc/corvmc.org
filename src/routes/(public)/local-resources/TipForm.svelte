<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { Turnstile } from 'svelte-turnstile';
	import Form, { Field, SubmitButton } from '#lib/components/ui/Form/index.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import {
		getLocalResourceTipCategories,
		submitLocalResourceTip
	} from '#lib/remote/local-resources.remote.js';
	import { TURNSTILE_SITE_KEY, turnstileFailureMessage } from '#lib/turnstile.js';
	import type { RemoteFormIssue } from '$app/server';

	/**
	 * The structured tip (#1498): it becomes a pending listing staff publish or
	 * return, and the email is where the outcome goes. `onfailure` suppresses
	 * Form's fallback toast, so the Turnstile failure is rendered here (#803).
	 */
	let submitted = $state(false);
	let failure = $state<string | null>(null);
	let resetTurnstile = $state<() => void>();

	const categories = $derived(await getLocalResourceTipCategories());
	const { fields } = submitLocalResourceTip;
</script>

{#if submitted}
	<Alert type="success">
		{m.public_local_resources_tip_form_thanks_suggestion_we_ll_take()}
	</Alert>
{:else}
	<Form
		remote={submitLocalResourceTip}
		class="flex flex-col gap-2"
		onsuccess={() => {
			submitted = true;
			failure = null;
		}}
		onfailure={(issues) => {
			resetTurnstile?.();
			failure = turnstileFailureMessage((issues as RemoteFormIssue[] | null) ?? null);
		}}
	>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<Field
				field={fields.name}
				type="text"
				label={m.public_local_resources_tip_form_name_place_service()}
			/>
			<Field
				field={fields.categoryId}
				type="select"
				label={m.public_local_resources_tip_form_category()}
				placeholder={m.public_local_resources_tip_form_placeholder()}
				options={categories}
			/>
		</div>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<Field
				field={fields.website}
				type="text"
				label={m.public_local_resources_tip_form_website()}
			/>
			<Field field={fields.phone} type="tel" label={m.public_phone()} />
		</div>
		<Field
			field={fields.addressLine}
			type="text"
			label={m.public_local_resources_tip_form_address_area()}
		/>
		<Field
			field={fields.description}
			type="textarea"
			label={m.public_local_resources_tip_form_what_why_worth_knowing()}
		/>
		<Field
			field={fields.submitterEmail}
			type="email"
			label={m.public_email_2()}
			description={m.public_local_resources_tip_form_description()}
		/>
		<Turnstile
			siteKey={TURNSTILE_SITE_KEY}
			responseFieldName={fields.turnstileToken.as('hidden', '').name}
			theme="auto"
			bind:reset={resetTurnstile}
		/>
		{#if failure}
			<Alert type="error">{failure}</Alert>
		{/if}
		<SubmitButton
			label={m.public_local_resources_tip_form_suggest_resource()}
			variant="primary"
			class="mt-2"
		/>
	</Form>
{/if}
