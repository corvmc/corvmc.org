<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { Turnstile } from 'svelte-turnstile';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Form, { Field, SubmitButton } from '$lib/components/shared/Form';
	import { getPublicAudiences, subscribeToAudience } from '$lib/remote/marketing.remote';
	import { TURNSTILE_SITE_KEY, TURNSTILE_RESPONSE_FIELD } from '$lib/turnstile';

	const { fields } = subscribeToAudience;

	let audiences = $derived(await getPublicAudiences());

	let selectedAudienceId = $state('');
	let success = $state(false);

	const selectedSlug = $derived(audiences.find((a) => a.id === selectedAudienceId)?.slug ?? '');
</script>

<div class="max-w-lg mx-auto p-6 space-y-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold">Subscribe</h1>
		<p class="opacity-60 mt-1">Join our mailing lists to stay in the loop.</p>
	</div>

	{#if success}
		<Alert type="success">You've been subscribed! Check your inbox for future updates.</Alert>
		<Button
			variant="ghost"
			size="sm"
			onclick={() => {
				success = false;
				selectedAudienceId = '';
			}}
		>
			Subscribe to another list
		</Button>
	{:else if audiences.length === 0}
		<p class="text-center opacity-60">No mailing lists are currently accepting signups.</p>
	{:else}
		<Form
			remote={subscribeToAudience}
			onsuccess={() => {
				success = true;
			}}
			class="space-y-4"
		>
			<input {...fields.slug.as('hidden', selectedSlug)} />
			<Field name="audience" label="Choose a list">
				<div class="space-y-2">
					{#each audiences as a (a.id)}
						<label
							class="label cursor-pointer gap-3 border rounded-lg px-4 py-3 {selectedAudienceId ===
							a.id
								? 'border-primary bg-primary/10'
								: 'border-base-300'}"
						>
							<input
								type="radio"
								name="audience"
								class="radio radio-primary radio-sm"
								value={a.id}
								bind:group={selectedAudienceId}
							/>
							<div class="flex-1">
								<p class="font-medium text-sm">{a.name}</p>
								{#if a.description}
									<p class="text-subtle">{a.description}</p>
								{/if}
							</div>
						</label>
					{/each}
				</div>
			</Field>

			<Field name="email" type="email" label="Email" placeholder="your@email.com" />
			<Field name="name" type="text" label="Name (optional)" placeholder="Your name" />

			<Turnstile
				siteKey={TURNSTILE_SITE_KEY}
				responseFieldName={TURNSTILE_RESPONSE_FIELD}
				theme="auto"
			/>

			<SubmitButton label="Subscribe" variant="primary" class="w-full" />
		</Form>
	{/if}
</div>
