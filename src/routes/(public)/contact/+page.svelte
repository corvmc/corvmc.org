<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { pageTitle, EVENT_TIP_SUBJECT, contactSubjects } from '$lib/config';
	import { IconMail, IconMapPin } from '@tabler/icons-svelte';
	import { Turnstile } from 'svelte-turnstile';
	import { signInHref } from '$lib/utils/sign-in';
	import { submitContactForm } from '$lib/remote/inbox.remote';
	import { getOrgAddress } from '$lib/remote/settings.remote';
	import {
		TURNSTILE_SITE_KEY,
		TURNSTILE_RESPONSE_FIELD,
		turnstileFailureMessage
	} from '$lib/turnstile';
	import type { RemoteFormIssue } from '@sveltejs/kit';

	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';

	// Declared before the awaited query below — a declaration that follows a
	// top-level await is async-gated.
	const fields = submitContactForm.fields;

	const address = $derived(await getOrgAddress());
	const cityStateZip = $derived(
		[[address.city, address.state].filter(Boolean).join(', '), address.zip]
			.filter(Boolean)
			.join(' ')
	);

	let submitted = $state(false);
	let failure = $state<string | null>(null);
	let resetTurnstile = $state<() => void>();

	// The list lives in `$lib/config` because the staff inbox filters on it: what
	// someone picks here is written to `inbox_thread.subject`, and that column is
	// the queue's inquiry-type facet.
	const subjectOptions = contactSubjects.map((s) => ({ value: s, label: s }));

	// Anyone can tip us off about a show without an account. The extra fields are
	// optional and free-text: a tip is a lead for a staffer to chase, not a
	// record, so it lands as an ordinary thread in the inbox rather than growing
	// its own queue to remember to check.
	let subject = $state('General Inquiry');
	const isEventTip = $derived(subject === EVENT_TIP_SUBJECT);
</script>

<svelte:head>
	<title>{pageTitle('Contact')}</title>
	<meta name="description" content="Get in touch with the Corvallis Music Collective." />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-12">
	<p class="eyebrow mb-2">{m.public_contact_get_touch()}</p>
	<h1 class="mb-8 text-3xl font-bold">{m.public_contact_contact_us()}</h1>

	<div class="grid grid-cols-1 gap-8 md:grid-cols-3">
		<!-- Form -->
		<div class="md:col-span-2">
			{#if submitted}
				<Alert type="success">{m.public_contact_thanks_reaching_out_we_ll()}</Alert>
			{:else}
				<Form
					remote={submitContactForm}
					onsuccess={() => {
						submitted = true;
						failure = null;
					}}
					onfailure={(issues) => {
						resetTurnstile?.();
						// Passing `onfailure` at all suppresses Form's fallback toast, and the
						// field that fails here — the Turnstile token — has no visible input to
						// hang an error on. Without this, Send does nothing whatsoever.
						failure = turnstileFailureMessage((issues as RemoteFormIssue[] | null) ?? null);
					}}
					class="flex flex-col gap-4"
				>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<FormField field={fields.name} type="text" label={m.public_name()} required />
						<FormField field={fields.email} type="email" label={m.public_email()} required />
					</div>

					<FormField
						field={fields.subject}
						label={m.public_contact_subject()}
						type="select"
						options={subjectOptions}
						bind:value={subject}
					/>

					{#if isEventTip}
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<FormField
								field={fields.tipEventName}
								type="text"
								label={m.public_contact_what_s_show()}
								maxlength="200"
							/>
							<FormField
								field={fields.tipEventDate}
								type="text"
								label={m.public_contact_when()}
								placeholder={m.public_contact_e_g_fri_12_june()}
								maxlength="100"
							/>
							<FormField
								field={fields.tipVenue}
								type="text"
								label={m.public_contact_where()}
								maxlength="200"
							/>
							<FormField
								field={fields.tipLink}
								type="text"
								label={m.public_contact_link()}
								placeholder={m.public_contact_event_page_poster_anything()}
								maxlength="500"
							/>
						</div>
					{/if}

					<!-- Custom input mode: FormField's built-in textarea drops `rest`, so rows
					     and placeholder would be lost. Issues still resolve by name. -->
					<FormField name="message" label={m.public_contact_message()}>
						<textarea
							{...fields.message.as('text')}
							class="textarea w-full"
							rows="5"
							maxlength="5000"
							required
							placeholder={isEventTip ? m.public_contact_anything_else_worth_knowing_who() : ''}
						></textarea>
					</FormField>

					<Turnstile
						siteKey={TURNSTILE_SITE_KEY}
						responseFieldName={TURNSTILE_RESPONSE_FIELD}
						theme="auto"
						bind:reset={resetTurnstile}
					/>
					{#if failure}
						<Alert type="error">{failure}</Alert>
					{/if}
					<SubmitButton label={m.public_contact_send_message()} />
				</Form>
			{/if}
		</div>

		<!-- Sidebar -->
		<div class="space-y-6">
			<div>
				<h3 class="mb-2 flex items-center gap-2 font-semibold">
					<span class="text-cmc-teal"><IconMapPin size={18} /></span> Visit Us
				</h3>
				<p class="text-muted">
					{address.street}<br />
					{cityStateZip}
				</p>
				<p class="mt-1 text-xs text-fg-3">
					{m.public_contact_office_available_by_appointment_only()}
				</p>
			</div>

			<div>
				<h3 class="mb-2 flex items-center gap-2 font-semibold">
					<span class="text-cmc-teal"><IconMail size={18} /></span> Email
				</h3>
				<a href="mailto:info@corvmc.org" class="link text-sm"
					>{m.public_contact_info_corvmc_org()}</a
				>
			</div>

			<div>
				<h3 class="mb-2 font-semibold">{m.public_contact_quick_answers()}</h3>
				<div class="space-y-2 text-sm">
					<details class="collapse-arrow collapse bg-base-200">
						<summary class="collapse-title min-h-0 py-2 font-medium"
							>{m.public_contact_how_do_i_become_member()}</summary
						>
						<div class="collapse-content text-muted">
							<a href={signInHref({ register: true, returnTo: '/member' })} class="link"
								>{m.public_contact_create_account()}</a
							> to get started. Free memberships are available.
						</div>
					</details>
					<details class="collapse-arrow collapse bg-base-200">
						<summary class="collapse-title min-h-0 py-2 font-medium"
							>{m.public_contact_can_i_use_practice_space()}</summary
						>
						<div class="collapse-content text-muted">
							{m.public_contact_practice_space_available_all_members()}
						</div>
					</details>
					<details class="collapse-arrow collapse bg-base-200">
						<summary class="collapse-title min-h-0 py-2 font-medium"
							>{m.public_contact_how_do_i_submit_music()}</summary
						>
						<div class="collapse-content text-muted">
							All-ages, all genres — if you make music, we want to hear from you. Use the contact
							form with "Performance Inquiry" as the subject, or email a link to your music and any
							dates you have in mind to <a href="mailto:booking@corvmc.org" class="link"
								>{m.public_contact_booking_corvmc_org()}</a
							>.
						</div>
					</details>
				</div>
			</div>
		</div>
	</div>
</div>
