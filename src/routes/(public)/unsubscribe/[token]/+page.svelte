<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import {
		getUnsubscribeInfo,
		confirmUnsubscribe,
		confirmUnsubscribeAll
	} from '$lib/remote/marketing.remote';
	import { page } from '$app/state';

	let token = $derived(page.params.token!);
	let data = $derived(await getUnsubscribeInfo(token));

	const { fields } = confirmUnsubscribe;
	const allFields = confirmUnsubscribeAll.fields;

	// Loading the page no longer unsubscribes — that was happening on a GET, so
	// mail-client prefetchers and link scanners were unsubscribing people who
	// never clicked. The write happens when this form is submitted.
	let done = $state(false);
	let allDone = $state(false);
</script>

<div class="mx-auto max-w-md space-y-4 p-6 text-center">
	{#if !data.valid}
		<h1 class="text-2xl font-bold">{m.public_unsubscribe_token_invalid_link()}</h1>
		<p class="opacity-70">{m.public_unsubscribe_token_unsubscribe_link_invalid_has_alread()}</p>
	{:else if allDone}
		<h1 class="text-2xl font-bold">{m.public_unsubscribe_token_unsubscribed_from_everything()}</h1>
		<p class="opacity-70">
			{m.public_unsubscribe_token_won_t_receive_any_more()}
		</p>
	{:else if done}
		<h1 class="text-2xl font-bold">{m.public_unsubscribe_token_unsubscribed()}</h1>
		<p class="opacity-70">
			You've been unsubscribed from <strong>{data.audienceName}</strong>. You won't receive any more
			emails from this list.
		</p>
		<!-- The single-list unsubscribe is the main driver of spam complaints:
		     people leave one list, keep getting mail from another, and hit "mark as
		     spam" instead of coming back here. This is the escape hatch. -->
		<div class="space-y-2 border-t pt-4">
			<p class="text-muted">{m.public_unsubscribe_token_still_receiving_emails_don_t()}</p>
			<!-- SubmitButton wraps its button in a plain flex row, which would sit
			     left of centre inside this centred column. -->
			<div class="flex justify-center">
				<Form remote={confirmUnsubscribeAll} onsuccess={() => (allDone = true)}>
					<input {...allFields.token.as('hidden', token)} />
					<SubmitButton
						label={m.public_unsubscribe_token_unsubscribe_from_all_corvmc_emails()}
						variant="primary"
						size="sm"
						outline
					/>
				</Form>
			</div>
		</div>
	{:else}
		<h1 class="text-2xl font-bold">{m.public_unsubscribe_token_unsubscribe()}</h1>
		<p class="opacity-70">
			Stop receiving emails from <strong>{data.audienceName}</strong>?
		</p>
		<Form remote={confirmUnsubscribe} onsuccess={() => (done = true)}>
			<input {...fields.token.as('hidden', token)} />
			<SubmitButton label={m.public_unsubscribe_token_unsubscribe()} variant="primary" />
		</Form>
	{/if}

	<Button href="/" variant="ghost" size="sm">{m.public_unsubscribe_token_back_corvmc()}</Button>
</div>
