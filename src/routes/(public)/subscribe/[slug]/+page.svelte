<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Form, { Field, SubmitButton } from '#lib/components/ui/Form/index.js';
	import { getPublicAudienceBySlug, subscribeToAudience } from '#lib/remote/marketing.remote.js';
	import { page } from '$app/state';

	let data = $derived(await getPublicAudienceBySlug(page.params.slug!));

	let success = $state(false);
</script>

<div class="mx-auto max-w-md space-y-6 p-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold">{data.audience.name}</h1>
		{#if data.audience.description}
			<p class="mt-1 opacity-60">{data.audience.description}</p>
		{/if}
	</div>

	{#if success}
		<Alert type="success">{m.public_subscribe_slug_re_subscribed_look_out_our()}</Alert>
	{:else}
		<Form remote={subscribeToAudience} onsuccess={() => (success = true)} class="space-y-4">
			<input {...subscribeToAudience.fields.slug.as('hidden', data.audience.slug)} />
			<Field
				field={subscribeToAudience.fields.email}
				type="email"
				label={m.public_email()}
				placeholder={m.public_email_com()}
			/>
			<Field
				field={subscribeToAudience.fields.name}
				type="text"
				label={m.public_name_optional()}
				placeholder={m.public_name_2()}
			/>
			<SubmitButton label={m.public_subscribe()} variant="primary" class="w-full" />
		</Form>
	{/if}
</div>
