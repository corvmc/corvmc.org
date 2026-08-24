<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import { getBandProfile, getGenreSuggestions } from '$lib/remote/directory.remote';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import BandProfileForm from './BandProfileForm.svelte';

	// Resolve everything here and hand BandProfileForm plain props. The form must
	// not live in a component whose script awaits: a top-level await marks all
	// later declarations "blocked", turning every bind:value/fields expression
	// in the template into an async derived — the reactive churn behind the
	// effect_update_depth_exceeded crash on this page (same bug as
	// /member/profile, JAVASCRIPT-SVELTEKIT-W).
	const layout = await getBandLayout(page.params.slug!);
	const profile = await getBandProfile();
	const genreSuggestions = await getGenreSuggestions();

	const band = layout.band;
</script>

<PageHeader title="Band Profile" subtitle={band.name} />
<PageContent width="3xl">
	<BandProfileForm {band} {profile} {genreSuggestions} isOwner={layout.userRole === 'owner'} />
</PageContent>
