<script lang="ts">
	import { Turnstile } from 'svelte-turnstile';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { submitBandContactForm } from '$lib/remote/band-contact.remote';
	import { TURNSTILE_SITE_KEY, TURNSTILE_RESPONSE_FIELD } from '$lib/turnstile';

	let { slug, bandName }: { slug: string; bandName: string } = $props();

	let submitted = $state(false);
	let resetTurnstile = $state<() => void>();

	const rf = $derived(submitBandContactForm.for(slug));
	const fields = $derived(rf.fields);
</script>

{#if submitted}
	<div class="alert alert-success">Thanks! Your message has been sent to {bandName}.</div>
{:else}
	<Form
		remote={rf}
		onsuccess={() => (submitted = true)}
		onfailure={() => resetTurnstile?.()}
		class="flex flex-col gap-4"
	>
		<input {...fields.slug.as('hidden', slug)} />
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<FormField field={fields.name} type="text" label="Name" required />
			<FormField field={fields.email} type="email" label="Email" required />
		</div>
		<FormField field={fields.message} type="textarea" label="Message" rows={5} required />
		<Turnstile
			siteKey={TURNSTILE_SITE_KEY}
			responseFieldName={TURNSTILE_RESPONSE_FIELD}
			theme="auto"
			bind:reset={resetTurnstile}
		/>
		<SubmitButton label="Send Message" />
	</Form>
{/if}
