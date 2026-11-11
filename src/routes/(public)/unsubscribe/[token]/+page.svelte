<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import {
		getUnsubscribeInfo,
		confirmUnsubscribe,
		confirmUnsubscribeAll
	} from '#lib/remote/marketing.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('token');

	let token = $derived(params.token);
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
		<h1 class="text-2xl font-bold">{m.public_unsubscribe_token_invalid_link_title()}</h1>
		<p class="opacity-70">
			{m.public_unsubscribe_token_unsubscribe_link_invalid_has_alread_text()}
		</p>
	{:else if allDone}
		<h1 class="text-2xl font-bold">
			{m.public_unsubscribe_token_unsubscribed_from_everything_title()}
		</h1>
		<p class="opacity-70">
			{m.public_unsubscribe_token_won_t_receive_any_more_text()}
		</p>
	{:else if done}
		<h1 class="text-2xl font-bold">{m.public_unsubscribe_token_unsubscribed_title()}</h1>
		<p class="opacity-70">
			<ParaglideMessage
				message={m.public_unsubscribe_token_ve_been_unsubscribed_from_won_text}
				inputs={{ audienceName: data.audienceName }}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>
		<!-- The single-list unsubscribe is the main driver of spam complaints:
		     people leave one list, keep getting mail from another, and hit "mark as
		     spam" instead of coming back here. This is the escape hatch. -->
		<div class="space-y-2 border-t pt-4">
			<p class="text-muted">{m.public_unsubscribe_token_still_receiving_emails_don_t_text()}</p>
			<!-- SubmitButton wraps its button in a plain flex row, which would sit
			     left of centre inside this centred column. -->
			<div class="flex justify-center">
				<Form remote={confirmUnsubscribeAll} onsuccess={() => (allDone = true)}>
					<input {...allFields.token.as('hidden', token)} />
					<SubmitButton
						label={m.public_unsubscribe_token_unsubscribe_from_all_corvmc_emails_label()}
						variant="primary"
						size="sm"
						outline
					/>
				</Form>
			</div>
		</div>
	{:else}
		<h1 class="text-2xl font-bold">{m.public_unsubscribe_token_unsubscribe_title()}</h1>
		<p class="opacity-70">
			<ParaglideMessage
				message={m.public_unsubscribe_token_stop_receiving_emails_from_text}
				inputs={{ audienceName: data.audienceName }}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>
		<Form remote={confirmUnsubscribe} onsuccess={() => (done = true)}>
			<input {...fields.token.as('hidden', token)} />
			<SubmitButton label={m.public_unsubscribe_token_unsubscribe_label()} variant="primary" />
		</Form>
	{/if}

	<Button href="/" variant="ghost" size="sm"
		>{m.public_unsubscribe_token_back_corvmc_label()}</Button
	>
</div>
