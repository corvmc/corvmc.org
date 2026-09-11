<script lang="ts">
	import { page } from '$app/state';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { toast } from 'svelte-sonner';
	import { getContactSheet, saveContactSheetForm } from '$lib/remote/contact-sheet.remote';

	/**
	 * An act's own contact sheet.
	 *
	 * Outside `(public)` deliberately: that group's layout is the marketing site
	 * frame — header, nav, footer — and this is not a page of the site. It is a
	 * form somebody was emailed a link to, for a party that has no CMC presence
	 * and no account. Framing it as a site page would invite exactly the reading
	 * the spec rules out: that an external act has a page here.
	 *
	 * No session is involved anywhere. The token in the URL is the whole of the
	 * authorization, and it authorizes editing this one record and nothing else.
	 */
	const fields = saveContactSheetForm.fields;

	let token = $derived(page.params.token!);
	const sheet = $derived(await getContactSheet(token));

	let busy = $state(false);
	let riderError = $state<string | null>(null);

	async function send(method: 'POST' | 'DELETE', body?: FormData) {
		busy = true;
		riderError = null;
		try {
			const res = await fetch(`/api/acts/${token}/rider`, { method, body });
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				riderError = body?.message ?? 'That upload did not work.';
				return;
			}
			await getContactSheet(token).refresh();
			toast.success(method === 'POST' ? 'Rider received — thank you' : 'Rider removed');
		} finally {
			busy = false;
		}
	}

	async function upload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const body = new FormData();
		body.set('file', file);
		await send('POST', body);
		input.value = '';
	}

	const remove = () => send('DELETE');
</script>

<svelte:head>
	<title>{sheet.name} — contact sheet</title>
	<!-- Not a page of the site, and not one search engines should hold. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PageContent width="2xl">
	<h1 class="text-2xl font-semibold">{sheet.name}</h1>

	<Alert type="info" class="text-sm">
		This is everything the Corvallis Music Collective holds about you. Fill in what you would like
		us to have; leave the rest blank. Your name is set by CMC because it appears on posters and in
		our records — email us if it is wrong.
	</Alert>

	<Form remote={saveContactSheetForm} successToast="Saved — thank you">
		<input {...fields.token.as('hidden', token)} />

		<InfoCard title="About you">
			<FormField
				field={fields.bio}
				type="textarea"
				label="Bio"
				value={sheet.bio ?? ''}
				description="Used on event pages when you play here."
			/>
			<FormField
				field={fields.hometown}
				type="text"
				label="Where you're from"
				value={sheet.hometown ?? ''}
			/>
			<FormField
				field={fields.url}
				type="text"
				label="Your site"
				value={sheet.url ?? ''}
				placeholder="https://…"
				description="Where your name should link to on a bill. We don't host a page for you — this is where people go instead."
			/>
		</InfoCard>

		<InfoCard title="How we reach you">
			<p class="text-sm">
				Kept private. Used for booking and for sorting out anything that goes wrong — never shown
				publicly and never added to a mailing list.
			</p>
			<FormField field={fields.bookingName} type="text" label="Who to contact" />
			<FormField field={fields.bookingEmail} type="email" label="Email" />
			<FormField field={fields.bookingPhone} type="tel" label="Phone" />
		</InfoCard>

		<SubmitButton>Save</SubmitButton>
	</Form>

	<!--
		Outside the form above, and posting to a route rather than to a remote
		`form()`, because it carries a file. Uploading is its own act anyway: an
		act that attaches a rider and then leaves without pressing Save has still
		sent us the rider.
	-->
	<InfoCard title="Tech rider">
		<p class="text-sm">
			What you need on stage — inputs, backline, anything we have to know before the day. A PDF is
			ideal; a photo of a hand-drawn plot is fine.
		</p>

		{#if sheet.rider}
			<p class="mt-3 text-sm">
				We have <a href={sheet.rider.url} class="link" target="_blank" rel="noreferrer"
					>{sheet.rider.filename ?? 'your rider'}</a
				>. Uploading another replaces it.
			</p>
		{/if}

		{#if riderError}
			<Alert type="error" class="mt-3 text-sm">{riderError}</Alert>
		{/if}

		<div class="mt-3 flex flex-wrap items-center gap-2">
			<input
				type="file"
				accept="application/pdf,image/jpeg,image/png,image/webp"
				class="file-input"
				disabled={busy}
				onchange={upload}
			/>
			{#if sheet.rider}
				<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={remove}>
					Remove
				</Button>
			{/if}
		</div>
	</InfoCard>
</PageContent>
