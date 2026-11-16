<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { Turnstile } from 'svelte-turnstile';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { submitBandContactForm } from '#lib/remote/band-contact.remote.js';
	import { TURNSTILE_SITE_KEY, turnstileFailureMessage } from '#lib/turnstile.js';

	let { slug, bandName }: { slug: string; bandName: string } = $props();

	let submitted = $state(false);
	let failure = $state<string | null>(null);
	let resetTurnstile = $state<() => void>();

	const rf = $derived(submitBandContactForm.for(slug));
	const fields = $derived(rf.fields);
</script>

{#if submitted}
	<div class="alert alert-success">
		{m.band_site_band_site_band_contact_form_thanks_message_has_bee_text({ bandName })}
	</div>
{:else}
	<Form
		remote={rf}
		onsuccess={() => (submitted = true)}
		onfailure={(issues) => {
			resetTurnstile?.();
			// See ContactForm — the Turnstile field has no visible input, and
			// providing `onfailure` suppresses Form's fallback toast, so without
			// this the button does nothing while the challenge is still loading.
			failure = turnstileFailureMessage(issues);
		}}
		class="flex flex-col gap-4"
	>
		<input {...fields.slug.as('hidden', slug)} />
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<FormField
				field={fields.name}
				type="text"
				label={m.band_site_band_site_band_contact_form_name_label()}
				required
			/>
			<FormField
				field={fields.email}
				type="email"
				label={m.band_site_band_site_band_contact_form_email_label()}
				required
			/>
		</div>
		<FormField
			field={fields.message}
			type="textarea"
			label={m.band_site_band_site_band_contact_form_message_label()}
			rows={5}
			required
		/>
		<Turnstile
			siteKey={TURNSTILE_SITE_KEY}
			responseFieldName={fields.turnstileToken.as('hidden', '').name}
			theme="auto"
			bind:reset={resetTurnstile}
		/>
		{#if failure}
			<div class="alert alert-error" role="alert">{failure}</div>
		{/if}
		<SubmitButton label={m.band_site_band_site_band_contact_form_send_message_label()} />
	</Form>
{/if}
