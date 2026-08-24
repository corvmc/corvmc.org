<script lang="ts">
	import { pageTitle, EVENT_TIP_SUBJECT } from '$lib/config';
	import { IconMail, IconMapPin } from '@tabler/icons-svelte';
	import { Turnstile } from 'svelte-turnstile';
	import { resolve } from '$app/paths';
	import { submitContactForm } from '$lib/remote/inbox.remote';
	import { getOrgAddress } from '$lib/remote/settings.remote';
	import { TURNSTILE_SITE_KEY, TURNSTILE_RESPONSE_FIELD } from '$lib/turnstile';

	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';

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
	let resetTurnstile = $state<() => void>();

	const subjects = [
		'General Inquiry',
		'Membership Questions',
		'Practice Space',
		'Performance Inquiry',
		EVENT_TIP_SUBJECT,
		'Volunteer Opportunities',
		'Donations'
	];
	const subjectOptions = subjects.map((s) => ({ value: s, label: s }));

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

<div class="max-w-4xl mx-auto px-4 py-12">
	<p class="eyebrow mb-2">Get in Touch</p>
	<h1 class="text-3xl font-bold mb-8">Contact Us</h1>

	<div class="grid grid-cols-1 md:grid-cols-3 gap-8">
		<!-- Form -->
		<div class="md:col-span-2">
			{#if submitted}
				<Alert type="success">Thanks for reaching out! We'll get back to you soon.</Alert>
			{:else}
				<Form
					remote={submitContactForm}
					onsuccess={() => (submitted = true)}
					onfailure={() => resetTurnstile?.()}
					class="flex flex-col gap-4"
				>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<FormField field={fields.name} type="text" label="Name" required />
						<FormField field={fields.email} type="email" label="Email" required />
					</div>

					<FormField
						field={fields.subject}
						label="Subject"
						type="select"
						options={subjectOptions}
						bind:value={subject}
					/>

					{#if isEventTip}
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<FormField
								field={fields.tipEventName}
								type="text"
								label="What's the show?"
								maxlength="200"
							/>
							<FormField
								field={fields.tipEventDate}
								type="text"
								label="When is it?"
								placeholder="e.g. Fri 12 June, or just 'sometime in June'"
								maxlength="100"
							/>
							<FormField field={fields.tipVenue} type="text" label="Where?" maxlength="200" />
							<FormField
								field={fields.tipLink}
								type="text"
								label="Link"
								placeholder="Event page, poster, anything"
								maxlength="500"
							/>
						</div>
					{/if}

					<!-- Custom input mode: FormField's built-in textarea drops `rest`, so rows
					     and placeholder would be lost. Issues still resolve by name. -->
					<FormField name="message" label="Message">
						<textarea
							{...fields.message.as('text')}
							class="textarea w-full"
							rows="5"
							maxlength="5000"
							required
							placeholder={isEventTip
								? 'Anything else worth knowing — who else is on the bill, cover charge, all-ages...'
								: ''}
						></textarea>
					</FormField>

					<Turnstile
						siteKey={TURNSTILE_SITE_KEY}
						responseFieldName={TURNSTILE_RESPONSE_FIELD}
						theme="auto"
						bind:reset={resetTurnstile}
					/>
					<SubmitButton label="Send Message" />
				</Form>
			{/if}
		</div>

		<!-- Sidebar -->
		<div class="space-y-6">
			<div>
				<h3 class="font-semibold flex items-center gap-2 mb-2">
					<span class="text-cmc-teal"><IconMapPin size={18} /></span> Visit Us
				</h3>
				<p class="text-muted">
					{address.street}<br />
					{cityStateZip}
				</p>
				<p class="text-xs mt-1 text-fg-3">Office available by appointment only.</p>
			</div>

			<div>
				<h3 class="font-semibold flex items-center gap-2 mb-2">
					<span class="text-cmc-teal"><IconMail size={18} /></span> Email
				</h3>
				<a href="mailto:info@corvmc.org" class="link text-sm">info@corvmc.org</a>
			</div>

			<div>
				<h3 class="font-semibold mb-2">Quick Answers</h3>
				<div class="space-y-2 text-sm">
					<details class="collapse collapse-arrow bg-base-200">
						<summary class="collapse-title font-medium py-2 min-h-0"
							>How do I become a member?</summary
						>
						<div class="collapse-content text-muted">
							<a href={resolve('/login?register&redirect=/member')} class="link"
								>Create an account</a
							> to get started. Free memberships are available.
						</div>
					</details>
					<details class="collapse collapse-arrow bg-base-200">
						<summary class="collapse-title font-medium py-2 min-h-0"
							>Can I use the practice space?</summary
						>
						<div class="collapse-content text-muted">
							The practice space is available to all members. Sign up for a free membership to book
							your first session.
						</div>
					</details>
					<details class="collapse collapse-arrow bg-base-200">
						<summary class="collapse-title font-medium py-2 min-h-0"
							>How do I submit music for a show?</summary
						>
						<div class="collapse-content text-muted">
							All-ages, all genres — if you make music, we want to hear from you. Use the contact
							form with "Performance Inquiry" as the subject, or email a link to your music and any
							dates you have in mind to <a href="mailto:booking@corvmc.org" class="link"
								>booking@corvmc.org</a
							>.
						</div>
					</details>
				</div>
			</div>
		</div>
	</div>
</div>
