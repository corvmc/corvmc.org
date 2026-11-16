<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { pageTitle } from '#lib/config.js';
	import { resolve } from '$app/paths';
	import {
		getWishlistPledgeConfirmation,
		confirmWishlistPledge
	} from '#lib/remote/inventory.remote.js';

	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ErrorToastBoundary from '#lib/components/ui/ErrorToastBoundary.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('token');

	type Outcome = NonNullable<typeof confirmWishlistPledge.result>;

	const fields = confirmWishlistPledge.fields;
	let outcome = $state<Outcome | null>(null);

	const token = $derived(params.token);
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
					<CardTitle size="lg" level={2} class="justify-center"
						>{m.public_contribute_pledge_token_confirm_pledge_title()}</CardTitle
					>

					{#if outcome?.status === 'confirmed'}
						<Alert type="success" class="text-sm">
							{m.public_contribute_pledge_token_thank_wishlist_now_shows_as_body()}
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('contribute')}>
							{m.public_contribute_pledge_token_back_wishlist_label()}
						</Button>
					{:else if outcome?.status === 'taken'}
						<Alert type="info" class="text-sm">
							{m.public_contribute_pledge_token_someone_else_confirmed_first_body()}
						</Alert>
						<Button variant="primary" class="w-full" href={resolve('contribute')}>
							{m.public_contribute_pledge_token_see_what_else_we_need_label()}
						</Button>
					{:else if !pending || outcome}
						<Alert type="error" class="text-sm">
							{m.public_link_has_expired_has_already_body()}
						</Alert>
					{:else}
						<p class="text-center">
							<ParaglideMessage
								message={m.public_contribute_pledge_token_confirm_ll_bring_text}
								inputs={{ entryName: pending.entryName }}
								>{#snippet strong({ children })}<strong>{@render children?.()}</strong
									>{/snippet}</ParaglideMessage
							>
						</p>
						<Form remote={confirmWishlistPledge} onsuccess={(r) => (outcome = r ?? null)}>
							<input {...fields.token.as('hidden', token)} />
							<SubmitButton label={m.public_confirm_label()} variant="primary" class="w-full" />
						</Form>
					{/if}
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
