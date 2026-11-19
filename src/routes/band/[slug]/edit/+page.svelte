<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import * as env from '$app/env/public';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import AddressCard from '#lib/components/ui/AddressCard.svelte';
	import { canonicalAddress } from '#lib/utils/canonical-address.js';
	import { getBandProfileEditor } from '#lib/remote/directory.remote.js';
	import { getBandLayoutContext } from '../layout-context';
	import BandProfileForm from './BandProfileForm.svelte';

	// Resolve everything here and hand BandProfileForm plain props: a top-level
	// await in the form's own script turns every bind:value into an async derived,
	// the churn behind the effect_update_depth_exceeded crash on this page.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	// Above the await, from the resolved layout: it is the ref the query guards on.
	// svelte-ignore state_referenced_locally
	const slug = layout.band.slug;
	const band = $derived(layout.band);
	const isOwner = $derived(layout.userRole === 'owner');

	// The address every member hands out, here since #3127 rather than on the dashboard.
	const address = $derived(
		canonicalAddress({ kind: 'group', slug: band.slug }, { siteUrl: env.PUBLIC_SITE_URL })
	);

	const { profile, genreSuggestions, instrumentSuggestions, canEdit } = $derived(
		await getBandProfileEditor(slug)
	);
</script>

<PageHeader width="3xl" title={m.band_slug_edit_title()} subtitle={band.name} />
<PageContent width="3xl">
	{#if address}
		<AddressCard
			url={address}
			title={m.band_slug_settings_band_address_section_band_address_title()}
		>
			{m.band_slug_address_card_text()}
			{m.band_slug_edit_band_profile_form_renaming_band_doesn_t_move_text()}
			{#if isOwner}
				<a href={resolve('/band/[slug]/settings', { slug: band.slug })} class="link link-primary">
					{m.band_slug_edit_band_profile_form_change_settings_text()}
				</a>
			{/if}
		</AddressCard>
	{/if}

	<BandProfileForm {band} {profile} {genreSuggestions} {instrumentSuggestions} {canEdit} />
</PageContent>
