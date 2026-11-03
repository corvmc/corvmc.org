<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { Turnstile } from 'svelte-turnstile';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Form, { Field, SubmitButton } from '#lib/components/ui/Form/index.js';
	import { getPublicAudiences, subscribeToAudience } from '#lib/remote/marketing.remote.js';
	import { TURNSTILE_SITE_KEY, TURNSTILE_RESPONSE_FIELD } from '#lib/turnstile.js';

	const { fields } = subscribeToAudience;

	let audiences = $derived(await getPublicAudiences());

	let selectedAudienceId = $state('');
	let success = $state(false);

	const selectedSlug = $derived(audiences.find((a) => a.id === selectedAudienceId)?.slug ?? '');
</script>

<div class="mx-auto max-w-lg space-y-6 p-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold">{m.public_subscribe()}</h1>
		<p class="mt-1 opacity-60">{m.public_subscribe_join_our_mailing_lists_stay()}</p>
	</div>

	{#if success}
		<Alert type="success">{m.public_subscribe_ve_been_subscribed_check_inbox()}</Alert>
		<Button
			variant="ghost"
			size="sm"
			onclick={() => {
				success = false;
				selectedAudienceId = '';
			}}
		>
			{m.public_subscribe_subscribe_another_list()}
		</Button>
	{:else if audiences.length === 0}
		<p class="text-center opacity-60">
			{m.public_subscribe_no_mailing_lists_currently_accepting()}
		</p>
	{:else}
		<Form
			remote={subscribeToAudience}
			onsuccess={() => {
				success = true;
			}}
			class="space-y-4"
		>
			<input {...fields.slug.as('hidden', selectedSlug)} />
			<Field name="audience" label={m.public_subscribe_choose_list()}>
				<div class="space-y-2">
					{#each audiences as a (a.id)}
						<label
							class="label cursor-pointer gap-3 rounded-lg border px-4 py-3 {selectedAudienceId ===
							a.id
								? 'border-primary bg-primary/10'
								: 'border-base-300'}"
						>
							<input
								type="radio"
								name="audience"
								class="radio radio-sm radio-primary"
								value={a.id}
								bind:group={selectedAudienceId}
							/>
							<div class="flex-1">
								<p class="text-sm font-medium">{a.name}</p>
								{#if a.description}
									<p class="text-subtle">{a.description}</p>
								{/if}
							</div>
						</label>
					{/each}
				</div>
			</Field>

			<Field
				name="email"
				type="email"
				label={m.public_email()}
				placeholder={m.public_email_com()}
			/>
			<Field
				name="name"
				type="text"
				label={m.public_name_optional()}
				placeholder={m.public_name_2()}
			/>

			<Turnstile
				siteKey={TURNSTILE_SITE_KEY}
				responseFieldName={TURNSTILE_RESPONSE_FIELD}
				theme="auto"
			/>

			<SubmitButton label={m.public_subscribe()} variant="primary" class="w-full" />
		</Form>
	{/if}
</div>
