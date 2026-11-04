<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { env } from '$env/dynamic/public';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import { changeBandAddress } from '#lib/remote/band-address.remote.js';
	import { baseDomainFromSiteUrl } from '#lib/utils/band-site-url.js';
	import { isReservedSlug } from '#lib/reserved-slugs.js';
	import Alert from '#lib/components/ui/Alert.svelte';

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
	<h2 class="text-lg font-semibold">{m.band_slug_settings_band_address_section_band_address()}</h2>

	<InfoCard title={`${slug}.${baseDomain}`}>
		<p class="text-sm">
			<ParaglideMessage
				message={m.band_slug_settings_band_address_section_band_s_address_s_als}
				inputs={{ slug }}
				>{#snippet code({ children })}<code class="text-xs">{@render children?.()}</code
					>{/snippet}</ParaglideMessage
			>
		</p>
		{#if readonly}
			<!-- Admins can see the address; only the owner can move it, because
			     `changeBandAddress` is owner-guarded. A button that 403s would be
			     worse than none. -->
			<p class="mt-2 text-subtle">
				{m.band_slug_settings_band_address_section_only_band_s_owner_ca()}
			</p>
		{:else}
			<div class="mt-2 card-actions justify-end">
				<Button
					variant="default"
					size="sm"
					outline
					data-testid="change-address"
					onclick={() => (showChange = true)}
					>{m.band_slug_settings_band_address_section_change_address()}</Button
				>
			</div>
		{/if}
	</InfoCard>
</section>

<Modal title={m.band_slug_settings_band_address_section_title()} bind:open={showChange}>
	<Form
		remote={changeBandAddress}
		onsuccess={(result) => {
			showChange = false;
			if (!result?.changed) {
				toast.info(m.band_slug_settings_band_address_section_already_address());
				return;
			}
			toast.success(m.band_slug_settings_band_address_section_address_updated());
			// Straight to the new URL — no invalidateAll() first. Every query on this
			// page is still keyed on the old slug, so re-running them here would
			// bounce through the old-address redirect. Changing page.params.slug
			// re-keys them instead.
			goto(resolve(`band/${result.slug}/settings`));
		}}
	>
		<div class="space-y-4">
			<!-- The band this renames. `newSlug` is the desired address, so the ref
			     the guard resolves has to travel separately. -->
			<input {...fields.slug.as('hidden', slug)} />

			<!-- `oninput` rather than `bind:value`: FormField leaves an input
			     uncontrolled when it is handed a remote `field`, so a binding here
			     would never fire and the preview below would sit on the old slug. -->
			<FormField
				field={fields.newSlug}
				type="text"
				label={m.band_slug_settings_band_address_section_new_address()}
				placeholder={m.band_slug_settings_band_address_section_placeholder()}
				oninput={(e: Event & { currentTarget: HTMLInputElement }) =>
					(draft = e.currentTarget.value)}
				description={m.band_slug_settings_band_address_section_description()}
				required
			/>

			{#if normalized}
				<p class="text-sm">
					<ParaglideMessage
						message={m.band_slug_settings_band_address_section_band_s_site_moves}
						inputs={{ normalized, baseDomain }}
						>{#snippet strong({ children })}<strong>{@render children?.()}</strong
							>{/snippet}</ParaglideMessage
					>
				</p>
			{/if}

			{#if reserved}
				<p class="text-sm text-error">
					{m.band_slug_settings_band_address_section_address_reserved_pic()}
				</p>
			{/if}

			<Alert type="warning" class="text-sm">
				<ParaglideMessage
					message={m.band_slug_settings_band_address_section_links_will_forward_n}
					inputs={{ slug, baseDomain }}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
			</Alert>

			<div class="flex justify-end pt-2">
				<SubmitButton
					label={m.band_slug_settings_band_address_section_change_address()}
					successLabel={m.band_slug_settings_band_address_section_success_label()}
					variant="warning"
				/>
			</div>
		</div>
	</Form>
</Modal>
