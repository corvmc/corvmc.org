<script lang="ts">
	import { pageTitle } from '$lib/config';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		getWishlistPledgeConfirmation,
		confirmWishlistPledge
	} from '$lib/remote/inventory.remote';

	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';

	type Outcome = NonNullable<typeof confirmWishlistPledge.result>;

	const fields = confirmWishlistPledge.fields;
	let outcome = $state<Outcome | null>(null);

	const token = $derived(page.params.token!);
	// Reading the link changes nothing, so a mail client prefetching it is
	// harmless; the pledge opens on the POST below.
	const pending = $derived(await getWishlistPledgeConfirmation(token));
</script>

<svelte:head>
	<title>{pageTitle('Confirm your pledge')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ErrorToastBoundary>
	<div class="flex items-center justify-center px-4 py-16">
		<div class="w-full max-w-sm">
			<div class="card shadow-xl surface">
				<CardBody class="gap-4">
					<CardTitle size="lg" level={2} class="justify-center">Confirm your pledge</CardTitle>

					{#if outcome?.status === 'confirmed'}
						<Alert type="success" class="text-sm">
							Thank you. The wishlist now shows it as taken for 30 days. Drop it off at the space
							whenever suits you.
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('/contribute')}>
							Back to the wishlist
						</Button>
					{:else if outcome?.status === 'taken'}
						<Alert type="info" class="text-sm">
							Someone else confirmed first, so this one is covered. Thank you all the same.
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('/contribute')}>
							See what else we need
						</Button>
					{:else if !pending || outcome}
						<Alert type="error" class="text-sm">
							This link has expired or has already been used.
						</Alert>
					{:else}
						<p class="text-center">
							Confirm that you'll bring <strong>{pending.entryName}</strong>?
						</p>
						<Form remote={confirmWishlistPledge} onsuccess={(r) => (outcome = r ?? null)}>
							<input {...fields.token.as('hidden', token)} />
							<SubmitButton label="Confirm" variant="primary" class="w-full" />
						</Form>
					{/if}
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
