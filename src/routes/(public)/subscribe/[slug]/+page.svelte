<script lang="ts">
	import Alert from '$lib/components/shared/Alert.svelte';
	import Form, { Field, SubmitButton } from '$lib/components/shared/Form';
	import { getPublicAudienceBySlug, subscribeToAudience } from '$lib/remote/marketing.remote';
	import { page } from '$app/state';

	let data = $derived(await getPublicAudienceBySlug(page.params.slug!));

	let success = $state(false);
</script>

<div class="max-w-md mx-auto p-6 space-y-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold">{data.audience.name}</h1>
		{#if data.audience.description}
			<p class="opacity-60 mt-1">{data.audience.description}</p>
		{/if}
	</div>

	{#if success}
		<Alert type="success">You're subscribed! Look out for our next email.</Alert>
	{:else}
		<Form remote={subscribeToAudience} onsuccess={() => (success = true)} class="space-y-4">
			<input type="hidden" name="slug" value={data.audience.slug} />
			<Field name="email" type="email" label="Email" placeholder="your@email.com" />
			<Field name="name" type="text" label="Name (optional)" placeholder="Your name" />
			<SubmitButton label="Subscribe" variant="primary" class="w-full" />
		</Form>
	{/if}
</div>
