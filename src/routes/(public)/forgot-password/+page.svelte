<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { pageTitle } from '$lib/config';
	import { resolve } from '$app/paths';
	import { requestPasswordReset } from '$lib/remote/password-reset.remote';

	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';

	const fields = requestPasswordReset.fields;

	let submitted = $state(false);
</script>

<svelte:head>
	<title>{pageTitle('Forgot password')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ErrorToastBoundary>
	<div class="flex items-center justify-center px-4 py-16">
		<div class="w-full max-w-sm">
			<div class="card shadow-xl surface">
				<CardBody class="gap-4">
					<CardTitle size="lg" level={2} class="justify-center"
						>{m.public_forgot_password_reset_password()}</CardTitle
					>

					{#if submitted}
						<!--
							Deliberately says nothing about whether the address has an account.
							The remote function returns this same state for an unknown address
							and for a throttled one.
						-->
						<Alert type="success" class="text-sm">
							{m.public_forgot_password_if_address_has_account_reset()}
						</Alert>
					{:else}
						<p class="text-muted">
							{m.public_forgot_password_enter_email_address_account_we()}
						</p>

						<Form
							remote={requestPasswordReset}
							onsuccess={() => (submitted = true)}
							class="flex flex-col gap-3"
						>
							<FormField field={fields.email} type="email" label={m.public_email()} required />
							<SubmitButton
								label={m.public_forgot_password_send_reset_link()}
								variant="primary"
								class="mt-1 w-full"
							/>
						</Form>
					{/if}

					<div class="text-center text-sm">
						<a class="link" href={resolve('/login')}>{m.public_forgot_password_back_sign()}</a>
					</div>
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
