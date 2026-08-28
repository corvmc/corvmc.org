<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { getBandProfileEditor } from '$lib/remote/directory.remote';
	import { getBandLayoutContext } from '../layout-context';
	import BandProfileForm from './BandProfileForm.svelte';

	// Resolve everything here and hand BandProfileForm plain props. The form must
	// not live in a component whose script awaits: a top-level await marks all
	// later declarations "blocked", turning every bind:value/fields expression
	// in the template into an async derived — the reactive churn behind the
	// effect_update_depth_exceeded crash on this page (same bug as
	// /member/profile, JAVASCRIPT-SVELTEKIT-W).
	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	// Above the await, and read from the resolved layout rather than
	// `page.params`: it is the ref the editor query guards on.
	const band = layout.band;
	const { profile, genreSuggestions } = await getBandProfileEditor(band.slug);
</script>

<PageHeader title="Band Profile" subtitle={band.name} />
<PageContent width="3xl">
	<BandProfileForm {band} {profile} {genreSuggestions} isOwner={layout.userRole === 'owner'} />
</PageContent>
