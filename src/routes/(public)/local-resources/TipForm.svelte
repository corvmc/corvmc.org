<script lang="ts">
	import { Turnstile } from 'svelte-turnstile';
	import Form, { Field, SubmitButton } from '$lib/components/ui/Form';
	import Alert from '$lib/components/ui/Alert.svelte';
	import {
		getLocalResourceTipCategories,
		submitLocalResourceTip
	} from '$lib/remote/local-resources.remote';
	import {
		TURNSTILE_SITE_KEY,
		TURNSTILE_RESPONSE_FIELD,
		turnstileFailureMessage
	} from '$lib/turnstile';
	import type { RemoteFormIssue } from '@sveltejs/kit';

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
		Thanks for the suggestion! We'll take a look and email you once it is listed, or if we need
		something changed.
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
			<Field field={fields.name} type="text" label="Name of the place or service" />
			<Field
				field={fields.categoryId}
				type="select"
				label="Category"
				placeholder="Pick one"
				options={categories}
			/>
		</div>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<Field field={fields.website} type="text" label="Website" />
			<Field field={fields.phone} type="tel" label="Phone" />
		</div>
		<Field field={fields.addressLine} type="text" label="Address or area" />
		<Field
			field={fields.description}
			type="textarea"
			label="What is it, and why is it worth knowing?"
		/>
		<Field
			field={fields.submitterEmail}
			type="email"
			label="Your email"
			description="Only used to tell you whether it was listed. Never shown on the page."
		/>
		<Turnstile
			siteKey={TURNSTILE_SITE_KEY}
			responseFieldName={TURNSTILE_RESPONSE_FIELD}
			theme="auto"
			bind:reset={resetTurnstile}
		/>
		{#if failure}
			<Alert type="error">{failure}</Alert>
		{/if}
		<SubmitButton label="Suggest this resource" variant="primary" class="mt-2" />
	</Form>
{/if}
