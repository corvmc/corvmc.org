<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
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

<div class="max-w-md mx-auto p-6 text-center space-y-4">
	{#if !data.valid}
		<h1 class="text-2xl font-bold">Invalid Link</h1>
		<p class="opacity-70">This unsubscribe link is invalid or has already been used.</p>
	{:else if allDone}
		<h1 class="text-2xl font-bold">Unsubscribed from everything</h1>
		<p class="opacity-70">
			You won't receive any more emails from CorvMC. You can sign up again any time.
		</p>
	{:else if done}
		<h1 class="text-2xl font-bold">Unsubscribed</h1>
		<p class="opacity-70">
			You've been unsubscribed from <strong>{data.audienceName}</strong>. You won't receive any more
			emails from this list.
		</p>
		<!-- The single-list unsubscribe is the main driver of spam complaints:
		     people leave one list, keep getting mail from another, and hit "mark as
		     spam" instead of coming back here. This is the escape hatch. -->
		<div class="border-t pt-4 space-y-2">
			<p class="text-muted">Still receiving emails you don't want?</p>
			<!-- SubmitButton wraps its button in a plain flex row, which would sit
			     left of centre inside this centred column. -->
			<div class="flex justify-center">
				<Form remote={confirmUnsubscribeAll} onsuccess={() => (allDone = true)}>
					<input {...allFields.token.as('hidden', token)} />
					<SubmitButton
						label="Unsubscribe from all CorvMC emails"
						variant="primary"
						size="sm"
						outline
					/>
				</Form>
			</div>
		</div>
	{:else}
		<h1 class="text-2xl font-bold">Unsubscribe</h1>
		<p class="opacity-70">
			Stop receiving emails from <strong>{data.audienceName}</strong>?
		</p>
		<Form remote={confirmUnsubscribe} onsuccess={() => (done = true)}>
			<input {...fields.token.as('hidden', token)} />
			<SubmitButton label="Unsubscribe" variant="primary" />
		</Form>
	{/if}

	<Button href="/" variant="ghost" size="sm">Back to CorvMC</Button>
</div>
