<script lang="ts">
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { deleteBand as deleteBandForm } from '$lib/remote/bands.remote';
	import { getBandLayoutContext } from '../layout-context';
	import { getCustomDomain } from '$lib/remote/band-custom-domain.remote';
	import BandAddressSection from './BandAddressSection.svelte';
	import CustomDomainSection from './CustomDomainSection.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	// Above the awaited query below: a declaration that follows a top-level await
	// is async-gated, which would compile `fields.bandId.as()` into an async
	// derived. Pinned by `src/async-effect-shape.spec.ts`.
	const deleteFields = deleteBandForm.fields;

	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	const band = $derived(layout.band);

	// Owner-only and premium-only: the query enforces both, so asking for it as
	// anyone else would surface an error banner instead of just hiding a section.
	const showCustomDomain = $derived(
		layout.features.bandPremium && band.tier === 'premium' && layout.userRole === 'owner'
	);
	let customDomain = $derived(showCustomDomain ? await getCustomDomain(band.slug) : null);

	const isOwner = $derived(layout.userRole === 'owner');
	const isAdmin = $derived(layout.userRole === 'admin');

	let showDeleteModal = $state(false);
</script>

<PageHeader title="Settings" subtitle={band.name} />
<PageContent width="md">
	<!-- The free subdomain is the band's primary address; the custom domain below
	     is the upsell on top of it. -->
	<!-- Admins reach this page now, so its body has to answer for them too.
	     Every control here is owner-guarded on the server; showing an admin a
	     button that 403s would be worse than showing them the value read-only. -->
	{#if isOwner || isAdmin}
		<BandAddressSection slug={band.slug} readonly={!isOwner} />
		<div class="h-8"></div>
	{:else}
		<Alert type="info" href={`/staff/bands/${band.id}`}>
			You're viewing this band as staff. The band's address and deletion are owner-only — staff
			tools for this band are on the staff band page.
		</Alert>
	{/if}

	{#if customDomain}
		<CustomDomainSection slug={band.slug} domain={customDomain} />
		<div class="h-8"></div>
	{/if}

	{#if isOwner}
		<section class="space-y-4">
			<h2 class="text-lg font-semibold text-error">Danger Zone</h2>
			<div class="card border border-error/30 bg-base-100">
				<CardBody>
					<p class="text-sm">
						Deleting this act will cancel all future reservations and remove all members. This
						action cannot be undone.
					</p>
					<div class="mt-2 card-actions justify-end">
						<Button variant="error" size="sm" outline onclick={() => (showDeleteModal = true)}>
							Delete Act
						</Button>
					</div>
				</CardBody>
			</div>
		</section>
	{/if}
</PageContent>

<Modal title="Delete Act" bind:open={showDeleteModal}>
	<Form
		remote={deleteBandForm}
		onsuccess={() => {
			toast.success('Act deleted');
			goto(resolve('/member/bands'));
		}}
		onfailure={() => toast.error('Failed to delete act')}
	>
		<div class="space-y-4">
			<input {...deleteFields.bandId.as('hidden', band.id)} />
			<Alert type="error">
				Are you sure you want to permanently delete <strong>{band.name}</strong>? All future
				reservations will be cancelled and all members will be removed.
			</Alert>
			<div class="flex justify-end pt-2">
				<SubmitButton label="Delete Act" successLabel="Deleted" variant="error" />
			</div>
		</div>
	</Form>
</Modal>
