<script lang="ts">
	import Hero from '$lib/components/public/Hero.svelte';
	import ResourceDirectory from './ResourceDirectory.svelte';
	import { Turnstile } from 'svelte-turnstile';
	import Form, { Field, SubmitButton } from '$lib/components/ui/Form';
	import { submitContactForm } from '$lib/remote/inbox.remote';
	import {
		TURNSTILE_SITE_KEY,
		TURNSTILE_RESPONSE_FIELD,
		turnstileFailureMessage
	} from '$lib/turnstile';
	import type { RemoteFormIssue } from '@sveltejs/kit';
	import Alert from '$lib/components/ui/Alert.svelte';

	let submitted = $state(false);
	let failure = $state<string | null>(null);
	let resetTurnstile = $state<() => void>();
	let resourceType = $state('Local Resource: Music Shop / Gear');

	const rf = submitContactForm.for('local-resources');

	const resourceTypes = [
		{ value: 'Local Resource: Music Shop / Gear', label: 'Music shop / gear' },
		{ value: 'Local Resource: Venue', label: 'Venue' },
		{ value: 'Local Resource: Record Store', label: 'Record store' },
		{ value: 'Local Resource: Artist / Band', label: 'Artist / band' },
		{ value: 'Local Resource: Studio / Rehearsal', label: 'Studio / rehearsal' },
		{ value: 'Local Resource: Other', label: 'Something else' }
	];
</script>

<svelte:head>
	<title>Local Resources | Corvallis Music Collective</title>
	<meta
		name="description"
		content="A community-built list of local music resources around Corvallis — shops, venues, record stores, artists, and more. Suggest one you think belongs."
	/>
</svelte:head>

<!-- Hero -->
<Hero title="Local Resources">
	Music shops, venues, record stores, studios and repair techs around Corvallis — the places we
	point people to. Know one we've missed? Tell us below.
</Hero>

<!-- The directory. Its own boundary: a failure drops the list, not the tip form. -->
<svelte:boundary>
	<ResourceDirectory />
	{#snippet failed()}{/snippet}
</svelte:boundary>

<!-- Submission form -->
<section class="section-tint-secondary px-6 py-16">
	<div class="mx-auto max-w-xl">
		<div class="mb-8 text-center">
			<h2 class="mb-2 text-3xl font-bold tracking-tight">Suggest a Resource</h2>
			<p class="text-base leading-relaxed text-fg-2">
				Know a resource the Corvallis music community should have on their radar? Send it our way.
			</p>
		</div>

		{#if submitted}
			<Alert type="success">
				Thanks for the suggestion! We'll take a look and add it to the list.
			</Alert>
		{:else}
			<Form
				remote={rf}
				class="flex flex-col gap-2"
				onsuccess={() => {
					submitted = true;
					failure = null;
				}}
				onfailure={(issues) => {
					resetTurnstile?.();
					// Passing `onfailure` at all suppresses Form's fallback toast, and the
					// field that fails here — the Turnstile token — has no visible input to
					// hang an error on. Without this, Send does nothing whatsoever.
					failure = turnstileFailureMessage((issues as RemoteFormIssue[] | null) ?? null);
				}}
			>
				<Field
					name="subject"
					type="select"
					label="Resource type"
					options={resourceTypes}
					bind:value={resourceType}
				/>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					<Field name="name" type="text" label="Your name" />
					<Field name="email" type="email" label="Email" />
				</div>
				<Field
					name="message"
					type="textarea"
					label="Tell us about it"
					description="Resource name, a link if you have one, and why it's worth knowing."
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
				<SubmitButton label="Submit Resource" variant="primary" class="mt-2" />
			</Form>
		{/if}
	</div>
</section>
