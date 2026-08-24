<script lang="ts">
	import Hero from '$lib/components/shared/marketing/Hero.svelte';
	import { IconBuildingStore, IconMicrophone, IconDisc, IconUsers } from '@tabler/icons-svelte';
	import { Turnstile } from 'svelte-turnstile';
	import Form, { Field, SubmitButton } from '$lib/components/shared/Form';
	import { submitContactForm } from '$lib/remote/inbox.remote';
	import { TURNSTILE_SITE_KEY, TURNSTILE_RESPONSE_FIELD } from '$lib/turnstile';
	import Alert from '$lib/components/shared/Alert.svelte';

	let submitted = $state(false);
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

	const categories = [
		{ icon: IconBuildingStore, label: 'Shops & gear' },
		{ icon: IconMicrophone, label: 'Venues & stages' },
		{ icon: IconDisc, label: 'Record stores' },
		{ icon: IconUsers, label: 'Artists & bands' }
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
	CMC keeps a list of local music resources — shops, artists, record stores, venues, and more. We're
	actively building it out, and we want your input.
</Hero>

<!-- What we're collecting -->
<section class="py-12 px-6">
	<div class="max-w-4xl mx-auto">
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
			{#each categories as cat (cat.label)}
				<div class="flex flex-col items-center text-center gap-2 rounded-lg p-5 surface">
					<div class="text-cmc-teal"><cat.icon size={32} /></div>
					<span class="text-sm font-medium">{cat.label}</span>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- Submission form -->
<section class="section-tint-secondary py-16 px-6">
	<div class="max-w-xl mx-auto">
		<div class="text-center mb-8">
			<h2 class="text-3xl font-bold tracking-tight mb-2">Suggest a Resource</h2>
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
				onsuccess={() => (submitted = true)}
				onfailure={() => resetTurnstile?.()}
			>
				<Field
					name="subject"
					type="select"
					label="Resource type"
					options={resourceTypes}
					bind:value={resourceType}
				/>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
				<SubmitButton label="Submit Resource" variant="primary" class="mt-2" />
			</Form>
		{/if}
	</div>
</section>
