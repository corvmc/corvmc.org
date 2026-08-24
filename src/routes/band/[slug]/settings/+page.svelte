<script lang="ts">
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { deleteBand as deleteBandForm } from '$lib/remote/bands.remote';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { getCustomDomain } from '$lib/remote/band-custom-domain.remote';
	import BandAddressSection from './BandAddressSection.svelte';
	import CustomDomainSection from './CustomDomainSection.svelte';
	import { page } from '$app/state';
	import Alert from '$lib/components/shared/Alert.svelte';

	let layout = $derived(await getBandLayout(page.params.slug!));
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
			<div class="card bg-base-100 border border-error/30">
				<CardBody>
					<p class="text-sm">
						Deleting this band will cancel all future reservations and remove all members. This
						action cannot be undone.
					</p>
					<div class="card-actions justify-end mt-2">
						<Button variant="error" size="sm" outline onclick={() => (showDeleteModal = true)}>
							Delete Band
						</Button>
					</div>
				</CardBody>
			</div>
		</section>
	{/if}
</PageContent>

<Modal title="Delete Band" bind:open={showDeleteModal}>
	<Form
		remote={deleteBandForm}
		onsuccess={() => {
			toast.success('Band deleted');
			goto(resolve('/member/bands'));
		}}
		onfailure={() => toast.error('Failed to delete band')}
	>
		<div class="space-y-4">
			<Alert type="error">
				Are you sure you want to permanently delete <strong>{band.name}</strong>? All future
				reservations will be cancelled and all members will be removed.
			</Alert>
			<div class="flex justify-end pt-2">
				<SubmitButton label="Delete Band" successLabel="Deleted" variant="error" />
			</div>
		</div>
	</Form>
</Modal>
