<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { pageTitle } from '#lib/config.js';
	import { formatDateYear } from '#lib/utils/format.js';
	import { getRemovalNotice, fileRemovalAppeal } from '#lib/remote/removal-notice.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const STAFF_EMAIL = 'staff@corvmc.org';
	const params = routeParams('token');

	let token = $derived(params.token);
	let notice = $derived(await getRemovalNotice(token));

	const { fields } = fileRemovalAppeal;
</script>

<svelte:head>
	<title>{pageTitle(m.public_removed_token_account_suspended_title())}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="mx-auto max-w-md space-y-4 p-6">
	{#if notice.state === 'invalid'}
		<h1 class="text-2xl font-bold">{m.public_removed_token_invalid_link_title()}</h1>
		<p class="opacity-70">{m.public_removed_token_invalid_link_text({ email: STAFF_EMAIL })}</p>
	{:else if notice.state === 'expired'}
		<h1 class="text-2xl font-bold">{m.public_removed_token_link_expired_title()}</h1>
		<p class="opacity-70">{m.public_removed_token_link_expired_text({ email: STAFF_EMAIL })}</p>
	{:else if notice.lifted}
		<h1 class="text-2xl font-bold">{m.public_removed_token_account_restored_title()}</h1>
		<p class="opacity-70">{m.public_removed_token_account_restored_text()}</p>
	{:else}
		<h1 class="text-2xl font-bold">{m.public_removed_token_account_suspended_title()}</h1>
		<p class="opacity-70">
			{#if notice.kind === 'suspension' && notice.endsAt}
				{m.public_removed_token_suspended_until_text({ date: formatDateYear(notice.endsAt) })}
			{:else}
				{m.public_removed_token_suspended_text()}
			{/if}
		</p>

		{#if notice.appeal === 'pending'}
			<h2 class="text-lg font-semibold">{m.public_removed_token_appeal_received_title()}</h2>
			<p class="opacity-70">{m.public_removed_token_appeal_received_text()}</p>
		{:else if notice.appeal === 'decided'}
			<h2 class="text-lg font-semibold">{m.public_removed_token_appeal_decided_title()}</h2>
			<p class="opacity-70">{m.public_removed_token_appeal_decided_text()}</p>
		{:else}
			<h2 class="text-lg font-semibold">{m.public_removed_token_appeal_title()}</h2>
			<Form remote={fileRemovalAppeal}>
				<input {...fields.token.as('hidden', token)} />
				<FormField
					field={fields.body}
					type="textarea"
					label={m.public_removed_token_appeal_body_label()}
					description={m.public_removed_token_appeal_help_body()}
					required
				/>
				<SubmitButton label={m.public_removed_token_send_appeal_label()} variant="primary" />
			</Form>
		{/if}
	{/if}

	<p class="text-muted">{m.public_removed_token_contact_text({ email: STAFF_EMAIL })}</p>
</div>
