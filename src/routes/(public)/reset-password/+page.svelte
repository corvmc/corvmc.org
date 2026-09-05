<script lang="ts">
	import { pageTitle } from '$lib/config';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { resetPassword } from '$lib/remote/password-reset.remote';

	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';

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
					<CardTitle size="lg" level={2} class="justify-center">Set a new password</CardTitle>

					{#if done}
						<Alert type="success" class="text-sm">
							Your password has been changed, and any other sessions were signed out.
						</Alert>
						<a class="btn w-full btn-primary" href={resolve('/login')}>Sign in</a>
					{:else if linkFailed}
						<Alert type="error" class="text-sm">
							That reset link has expired or has already been used.
						</Alert>
						<a class="btn w-full btn-primary" href={resolve('/forgot-password')}
							>Request a new link</a
						>
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
								label="New password"
								minlength={8}
								required
							/>
							<FormField
								field={fields.confirmPassword}
								type="password"
								label="Confirm new password"
								required
							/>
							<SubmitButton label="Set password" variant="primary" class="mt-1 w-full" />
						</Form>
					{/if}
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
