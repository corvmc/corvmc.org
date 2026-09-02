<script lang="ts">
	import { env } from '$env/dynamic/public';
	import { getMemberProfileEditor } from '$lib/remote/directory.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import AddressCard from '$lib/components/ui/AddressCard.svelte';
	import { canonicalAddress } from '$lib/utils/canonical-address';
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

	// Plain const rather than `$derived`: everything after the await above is
	// already async-gated, and nothing here changes without a refetch.
	const address = canonicalAddress(
		{ kind: 'member', memberNumber: profile?.memberNumber },
		{ siteUrl: env.PUBLIC_SITE_URL }
	);
</script>

<PageHeader subtitle="Profile" title="My Profile" />
<PageContent width="3xl">
	<!-- The address leads, ahead of the form: it is the thing a member has, and
	     the form is how they fill the page behind it. Absent only for an account
	     the backfill has not reached — a card advertising nothing is worse than
	     no card. -->
	{#if address}
		<AddressCard url={address} title="Your CMC address">
			Share this anywhere — it goes to your profile, whoever opens it.
		</AddressCard>
	{/if}

	<div class="mt-6">
		<ProfileForm {profile} {instrumentSuggestions} {genreSuggestions} />
	</div>

	<div class="mt-8">
		<TeachingCard
			instructor={teaching.instructor}
			hasPublicContact={teaching.hasPublicContact}
			hasAnyContact={teaching.hasAnyContact}
		/>
	</div>
</PageContent>
