<script lang="ts">
	import { getMemberProfileEditor } from '$lib/remote/directory.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import ProfileForm from './ProfileForm.svelte';
	import TeachingCard from './TeachingCard.svelte';

	// Resolve everything here and hand ProfileForm plain props. The form must
	// not live in a component whose script awaits: a top-level await marks all
	// later declarations "blocked", turning every bind:value/fields expression
	// in the template into an async derived — the reactive churn behind the
	// effect_update_depth_exceeded crashes on this page (JAVASCRIPT-SVELTEKIT-W).
	//
	// One query, not three. `custom/no-concurrent-remote-queries` refuses a page
	// that fans several out at once, so the teaching card's data is assembled
	// server-side in `getMemberProfileEditor` and arrives with everything else.
	const { profile, instrumentSuggestions, genreSuggestions, teaching } =
		await getMemberProfileEditor();
</script>

<PageHeader subtitle="Profile" title="My Profile" />
<PageContent width="3xl">
	<ProfileForm {profile} {instrumentSuggestions} {genreSuggestions} />

	<div class="mt-8">
		<TeachingCard
			instructor={teaching.instructor}
			hasPublicContact={teaching.hasPublicContact}
			hasAnyContact={teaching.hasAnyContact}
		/>
	</div>
</PageContent>
