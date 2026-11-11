<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import FileUpload from '#lib/components/ui/Form/FileUpload.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateShort, formatDateTime } from '#lib/utils/format.js';
	import { toast } from 'svelte-sonner';
	import { getContactSheet, saveContactSheetForm } from '#lib/remote/contact-sheet.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('token');

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

	let token = $derived(params.token);
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
			toast.success(
				method === 'POST'
					? m.public_act_token_rider_received_thank_toast()
					: m.public_act_token_rider_removed_toast()
			);
		} finally {
			busy = false;
		}
	}

	async function upload(file: File) {
		const body = new FormData();
		body.set('file', file);
		await send('POST', body);
	}

	const remove = () => send('DELETE');

	let artError = $state<string | null>(null);

	async function sendArt(file: File, requestId: string) {
		busy = true;
		artError = null;
		try {
			const body = new FormData();
			body.set('requestId', requestId);
			body.set('file', file);
			const res = await fetch(`/api/acts/${token}/poster-art`, { method: 'POST', body });
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { message?: string } | null;
				artError = err?.message ?? 'That upload did not work.';
				return;
			}
			await getContactSheet(token).refresh();
			toast.success(m.public_act_token_art_received_thank_toast());
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{m.public_act_token_contact_sheet_title({ name: sheet.name })}</title>
	<!-- Not a page of the site, and not one search engines should hold. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PageContent width="2xl">
	<h1 class="text-2xl font-semibold">{sheet.name}</h1>

	<Alert type="info" class="text-sm">
		{m.public_act_token_everything_corvallis_music_collective_holds_body()}
	</Alert>

	<Form remote={saveContactSheetForm} successToast={m.public_act_token_success_toast()}>
		<input {...fields.token.as('hidden', token)} />

		<InfoCard title={m.public_act_token_about_title()}>
			<FormField
				field={fields.bio}
				type="textarea"
				label={m.public_bio_label()}
				value={sheet.bio ?? ''}
				description={m.public_act_token_used_event_pages_when_play_body()}
			/>
			<FormField
				field={fields.hometown}
				type="text"
				label={m.public_act_token_where_re_from_label()}
				value={sheet.hometown ?? ''}
			/>
			<FormField
				field={fields.url}
				type="text"
				label={m.public_act_token_site_label()}
				value={sheet.url ?? ''}
				placeholder={m.public_act_token_placeholder()}
				description={m.public_act_token_where_name_should_link_bill_body()}
			/>
		</InfoCard>

		<InfoCard title={m.public_act_token_how_we_reach_title()}>
			<p class="text-sm">
				{m.public_act_token_kept_private_used_booking_sorting_text()}
			</p>
			<FormField
				field={fields.bookingName}
				type="text"
				label={m.public_act_token_who_contact_label()}
			/>
			<FormField field={fields.bookingEmail} type="email" label={m.public_email_label()} />
			<FormField field={fields.bookingPhone} type="tel" label={m.public_phone_label()} />
		</InfoCard>

		<SubmitButton>{m.public_act_token_save_label()}</SubmitButton>
	</Form>

	<!--
		Outside the form above, and posting to a route rather than to a remote
		`form()`, because it carries a file. Uploading is its own act anyway: an
		act that attaches a rider and then leaves without pressing Save has still
		sent us the rider.
	-->
	<InfoCard title={m.public_act_token_tech_rider_title()}>
		<p class="text-sm">
			{m.public_act_token_what_need_stage_inputs_backline_text()}
		</p>

		{#if sheet.rider}
			{@const rider = sheet.rider}
			<p class="mt-3 text-sm">
				<!-- `rel="external"` because the object is served from R2, not routed. -->
				<ParaglideMessage
					message={m.public_act_token_we_have_uploading_another_replaces_2_text}
					inputs={{ filename: rider.filename ?? m.public_act_token_rider_text() }}
					>{#snippet a({ children })}<a
							href={rider.url}
							class="link"
							target="_blank"
							rel="external noreferrer">{@render children?.()}</a
						>{/snippet}</ParaglideMessage
				>
			</p>
		{/if}

		{#if riderError}
			<Alert type="error" class="mt-3 text-sm">{riderError}</Alert>
		{/if}

		<div class="mt-3 flex flex-wrap items-center gap-2">
			<FileUpload
				{upload}
				accept="application/pdf,image/jpeg,image/png,image/webp"
				showPreview={false}
				disabled={busy}
				emptyLabel={sheet.rider
					? m.public_act_token_replace_rider_title()
					: m.public_act_token_upload_rider_title()}
			/>
			{#if sheet.rider}
				<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={remove}>
					{m.public_act_token_remove_label()}
				</Button>
			{/if}
		</div>
	</InfoCard>

	{#each sheet.posterAsks as ask (ask.id)}
		<InfoCard title={m.public_act_token_poster_art_title({ eventTitle: ask.eventTitle })}>
			<DefinitionList>
				<Fact label={m.public_act_token_when_label()}>{formatDateTime(ask.startsAt)}</Fact>
				{#if ask.venue}
					<Fact label={m.public_act_token_where_label()}>{ask.venue}</Fact>
				{/if}
				{#if ask.bill.length > 0}
					<Fact label={m.public_act_token_playing_label()}>{ask.bill.join(', ')}</Fact>
				{/if}
				<Fact label={m.public_act_token_art_due_label()}>
					{ask.dueAt
						? formatDateShort(ask.dueAt)
						: m.public_act_token_no_date_set_sooner_better_text()}
				</Fact>
			</DefinitionList>

			<p class="mt-3 text-sm">
				{m.public_act_token_jpeg_png_portrait_at_least_text()}
			</p>

			{#if ask.deliveredUrl}
				<p class="mt-3 text-sm">
					<ParaglideMessage
						message={m.public_act_token_we_have_uploading_another_replaces_text}
						inputs={{}}
						>{#snippet a({ children })}<a
								href={ask.deliveredUrl}
								class="link"
								target="_blank"
								rel="external noreferrer">{@render children?.()}</a
							>{/snippet}</ParaglideMessage
					>
				</p>
			{/if}

			{#if artError}
				<Alert type="error" class="mt-3 text-sm">{artError}</Alert>
			{/if}

			<div class="mt-3">
				<FileUpload
					upload={(file) => sendArt(file, ask.id)}
					accept="image/jpeg,image/png"
					showPreview={false}
					disabled={busy}
					emptyLabel={ask.deliveredUrl
						? m.public_act_token_replace_art_title()
						: m.public_act_token_upload_art_title()}
				/>
			</div>
		</InfoCard>
	{/each}
</PageContent>
