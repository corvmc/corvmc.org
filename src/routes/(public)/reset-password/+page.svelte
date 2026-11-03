<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { pageTitle } from '#lib/config.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { resetPassword } from '#lib/remote/password-reset.remote.js';

	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ErrorToastBoundary from '#lib/components/ui/ErrorToastBoundary.svelte';

	const fields = resetPassword.fields;

	// better-auth's `/reset-password/:token` callback validates the token before
	// sending anyone here, so a bad link arrives as `?error=INVALID_TOKEN` and
	// never reaches the form. Landing here with neither is the same dead end.
	const token = $derived(page.url.searchParams.get('token'));
	const linkFailed = $derived(page.url.searchParams.has('error') || !token);

	// The token lives in a hidden input, so it has no FormField to render its
	// issue into. Surfaced here instead — a token that expires between the click
	// and the submit is the one way this form can fail without a visible cause.
	const tokenIssues = $derived(fields.token.issues() ?? []);

	let done = $state(false);
</script>

<svelte:head>
	<title>{pageTitle('Set a new password')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ErrorToastBoundary>
	<div class="flex items-center justify-center px-4 py-16">
		<div class="w-full max-w-sm">
			<div class="card shadow-xl surface">
				<CardBody class="gap-4">
					<CardTitle size="lg" level={2} class="justify-center"
						>{m.public_reset_password_set_new_password()}</CardTitle
					>

					{#if done}
						<Alert type="success" class="text-sm">
							{m.public_reset_password_password_has_been_changed_any()}
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('/login')}
							>{m.public_sign()}</Button
						>
					{:else if linkFailed}
						<Alert type="error" class="text-sm">
							{m.public_reset_password_reset_link_has_expired_has()}
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('/forgot-password')}>
							{m.public_reset_password_request_new_link()}
						</Button>
					{:else}
						{#each tokenIssues as issue (issue.message)}
							<Alert type="error" class="text-sm">{issue.message}</Alert>
						{/each}

						<Form
							remote={resetPassword}
							onsuccess={() => (done = true)}
							class="flex flex-col gap-3"
						>
							<input {...fields.token.as('text', token ?? '')} type="hidden" />
							<FormField
								field={fields.newPassword}
								type="password"
								label={m.public_reset_password_new_password()}
								minlength={8}
								required
							/>
							<FormField
								field={fields.confirmPassword}
								type="password"
								label={m.public_reset_password_confirm_new_password()}
								required
							/>
							<SubmitButton
								label={m.public_reset_password_set_password()}
								variant="primary"
								class="mt-1 w-full"
							/>
						</Form>
					{/if}
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
