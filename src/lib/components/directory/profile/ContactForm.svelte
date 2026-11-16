<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { Turnstile } from 'svelte-turnstile';
	import ProfileSection from './ProfileSection.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { submitBandContactForm } from '#lib/remote/band-contact.remote.js';
	import { TURNSTILE_SITE_KEY, turnstileFailureMessage } from '#lib/turnstile.js';

	/**
	 * The only route to an act from its public page.
	 *
	 * This replaced a rendered `mailto:` and a phone number. The band's actual
	 * booking address lives in its press kit and is never sent to the browser, so
	 * there is nothing here for a scraper to collect — which is the whole reason
	 * the section is a form rather than a list of details.
	 *
	 * The microsite keeps its own `band-site/BandContactForm.svelte`: same remote
	 * function, different theme context, per `docs/development/ui-patterns.md`.
	 */
	let { slug, bandName }: { slug: string; bandName: string } = $props();

	let submitted = $state(false);
	let failure = $state<string | null>(null);
	let resetTurnstile = $state<() => void>();

	const rf = $derived(submitBandContactForm.for(slug));
	const fields = $derived(rf.fields);
</script>

<ProfileSection title={m.directory_profile_contact_form_title()}>
	{#if submitted}
		<p class="contact__done">
			{m.directory_profile_contact_form_sent_will_get_back_text({ bandName })}
		</p>
	{:else}
		<Form
			remote={rf}
			onsuccess={() => (submitted = true)}
			onfailure={(issues) => {
				resetTurnstile?.();
				// Passing `onfailure` at all suppresses Form's fallback toast, and
				// the field that usually fails here — the Turnstile token — has no
				// visible input to hang an error on. Without this line, Send does
				// nothing whatsoever while the challenge is still loading.
				failure = turnstileFailureMessage(issues);
			}}
			class="contact__form"
		>
			<input {...fields.slug.as('hidden', slug)} />
			<FormField
				field={fields.name}
				type="text"
				label={m.directory_profile_contact_form_name_label()}
				required
			/>
			<FormField
				field={fields.email}
				type="email"
				label={m.directory_profile_contact_form_email_label()}
				required
			/>
			<FormField
				field={fields.message}
				type="textarea"
				label={m.directory_profile_contact_form_message_label()}
				required
			/>
			<Turnstile
				siteKey={TURNSTILE_SITE_KEY}
				responseFieldName={fields.turnstileToken.as('hidden', '').name}
				theme="auto"
				bind:reset={resetTurnstile}
			/>
			{#if failure}
				<p class="contact__error" role="alert">{failure}</p>
			{/if}
			<SubmitButton label={m.directory_profile_contact_form_send_label()} />
		</Form>
	{/if}
</ProfileSection>

<style>
	.contact__done {
		margin: 0;
		font-size: 14px;
	}
	.contact__error {
		margin: 0;
		font-size: 14px;
		color: var(--color-error, #b3261e);
	}
	:global(.contact__form) {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
