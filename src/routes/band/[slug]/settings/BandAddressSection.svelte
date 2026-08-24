<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { env } from '$env/dynamic/public';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import { changeBandAddress } from '$lib/remote/band-address.remote';
	import { baseDomainFromSiteUrl } from '$lib/utils/band-site-url';
	import { isReservedSlug } from '$lib/reserved-slugs';
	import Alert from '$lib/components/shared/Alert.svelte';

	// A resolved prop, not an awaited query: a top-level await here would compile
	// the fields.X.as() expressions below into async deriveds (see BandProfileForm).
	let { slug, readonly = false }: { slug: string; readonly?: boolean } = $props();

	const fields = changeBandAddress.fields;
	const baseDomain = $derived(baseDomainFromSiteUrl(env.PUBLIC_SITE_URL));

	let showChange = $state(false);
	let draft = $state('');

	// A local mirror of `normalizeBandSlug` for the preview only — the server's
	// copy stays authoritative. The service module cannot be imported here; it
	// pulls in the database.
	const normalized = $derived(
		draft
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '')
	);
	const reserved = $derived(normalized.length > 0 && isReservedSlug(normalized));
</script>

<section class="space-y-4">
	<h2 class="text-lg font-semibold">Band Address</h2>

	<InfoCard title={`${slug}.${baseDomain}`}>
		<p class="text-sm">
			This is your band's address. It's also your profile at
			<code class="text-xs">/directory/bands/{slug}</code>
			and your dashboard at <code class="text-xs">/band/{slug}</code>.
		</p>
		{#if readonly}
			<!-- Admins can see the address; only the owner can move it, because
			     `changeBandAddress` is owner-guarded. A button that 403s would be
			     worse than none. -->
			<p class="text-subtle mt-2">Only the band's owner can change this address.</p>
		{:else}
			<div class="card-actions mt-2 justify-end">
				<Button variant="default" size="sm" outline onclick={() => (showChange = true)}
					>Change address</Button
				>
			</div>
		{/if}
	</InfoCard>
</section>

<Modal title="Change band address" bind:open={showChange}>
	<Form
		remote={changeBandAddress}
		onsuccess={(result) => {
			showChange = false;
			if (!result?.changed) {
				toast.info('That is already your address');
				return;
			}
			toast.success('Address updated');
			// Straight to the new URL — no invalidateAll() first. Every query on this
			// page is still keyed on the old slug, so re-running them here would
			// bounce through the old-address redirect. Changing page.params.slug
			// re-keys them instead.
			goto(resolve(`/band/${result.slug}/settings`));
		}}
		onfailure={() => {}}
	>
		<div class="space-y-4">
			<!-- `oninput` rather than `bind:value`: FormField leaves an input
			     uncontrolled when it is handed a remote `field`, so a binding here
			     would never fire and the preview below would sit on the old slug. -->
			<FormField
				field={fields.newSlug}
				type="text"
				label="New address"
				placeholder="the-band"
				oninput={(e: Event & { currentTarget: HTMLInputElement }) =>
					(draft = e.currentTarget.value)}
				description="Letters, numbers and hyphens. Spaces and punctuation are dropped."
				required
			/>

			{#if normalized}
				<p class="text-sm">
					Your band site moves to <strong>{normalized}.{baseDomain}</strong>.
				</p>
			{/if}

			{#if reserved}
				<p class="text-error text-sm">That address is reserved — pick another.</p>
			{/if}

			<Alert type="warning" class="text-sm">
				Links to <strong>{slug}.{baseDomain}</strong> will forward to the new address — but only until
				another band claims it, and then they stop. Update anywhere you've printed or posted the old one.
				You can only change this a few times a year.
			</Alert>

			<div class="flex justify-end pt-2">
				<SubmitButton label="Change address" successLabel="Changed" variant="warning" />
			</div>
		</div>
	</Form>
</Modal>
