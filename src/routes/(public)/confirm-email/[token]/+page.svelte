<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { pageTitle } from '#lib/config.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getEmailChangeRequest, confirmEmailChange } from '#lib/remote/email-change.remote.js';

	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ErrorToastBoundary from '#lib/components/ui/ErrorToastBoundary.svelte';

	type Outcome = NonNullable<typeof confirmEmailChange.result>;

	const fields = confirmEmailChange.fields;
	let outcome = $state<Outcome | null>(null);

	const token = $derived(page.params.token!);
	// Reading the link changes nothing, so a mail client prefetching it is
	// harmless; the change applies on the POST below.
	const request = $derived(await getEmailChangeRequest(token));
</script>

<svelte:head>
	<title>{pageTitle('Confirm your email')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ErrorToastBoundary>
	<div class="flex items-center justify-center px-4 py-16">
		<div class="w-full max-w-sm">
			<div class="card shadow-xl surface">
				<CardBody class="gap-4">
					<CardTitle size="lg" level={2} class="justify-center"
						>{m.public_confirm_email_token_confirm_email()}</CardTitle
					>

					{#if outcome?.status === 'changed'}
						<Alert type="success" class="text-sm">
							<ParaglideMessage
								message={m.public_confirm_email_token_now_sign_as_were_signed}
								inputs={{ email: outcome.email }}
								>{#snippet strong({ children })}<strong>{@render children?.()}</strong
									>{/snippet}</ParaglideMessage
							>
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('login')}
							>{m.public_sign()}</Button
						>
					{:else if outcome?.status === 'taken'}
						<Alert type="error" class="text-sm">
							{m.public_confirm_email_token_address_now_belongs_another_accou()}
						</Alert>
					{:else if !request || outcome}
						<Alert type="error" class="text-sm">
							{m.public_link_has_expired_has_already()}
						</Alert>
					{:else}
						<p class="text-center">
							<ParaglideMessage
								message={m.public_confirm_email_token_use_sign_corvmc_account_from}
								inputs={{ email: request.email }}
								>{#snippet strong({ children })}<strong>{@render children?.()}</strong
									>{/snippet}</ParaglideMessage
							>
						</p>
						<Form remote={confirmEmailChange} onsuccess={(r) => (outcome = r ?? null)}>
							<input {...fields.token.as('hidden', token)} />
							<SubmitButton label={m.public_confirm()} variant="primary" class="w-full" />
						</Form>
					{/if}
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
