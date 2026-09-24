<script lang="ts">
	import { pageTitle } from '$lib/config';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getEmailChangeRequest, confirmEmailChange } from '$lib/remote/email-change.remote';

	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';

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
					<CardTitle size="lg" level={2} class="justify-center">Confirm your email</CardTitle>

					{#if outcome?.status === 'changed'}
						<Alert type="success" class="text-sm">
							You now sign in as <strong>{outcome.email}</strong>. You were signed out everywhere,
							so sign in again with your usual password.
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('/login')}>Sign in</Button>
					{:else if outcome?.status === 'taken'}
						<Alert type="error" class="text-sm">
							That address now belongs to another account, so nothing was changed. Contact CMC staff
							to sort it out.
						</Alert>
					{:else if !request || outcome}
						<Alert type="error" class="text-sm">
							This link has expired or has already been used.
						</Alert>
					{:else}
						<p class="text-center">
							Use <strong>{request.email}</strong> to sign in to your CorvMC account from now on?
						</p>
						<Form remote={confirmEmailChange} onsuccess={(r) => (outcome = r ?? null)}>
							<input {...fields.token.as('hidden', token)} />
							<SubmitButton label="Confirm" variant="primary" class="w-full" />
						</Form>
					{/if}
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
