<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Hero from '$lib/components/public/Hero.svelte';
	import ResourceDirectory from './ResourceDirectory.svelte';
	import TipForm from './TipForm.svelte';
</script>

<svelte:head>
	<title>{m.public_local_resources_local_resources_corvallis_music_colle()}</title>
	<meta
		name="description"
		content="A community-built list of local music resources around Corvallis — shops, venues, record stores, artists, and more. Suggest one you think belongs."
	/>
</svelte:head>

<!-- Hero -->
<Hero title={m.public_local_resources_title()}>
	{m.public_local_resources_music_shops_venues_record_stores()}
</Hero>

<!-- The directory. Its own boundary: a failure drops the list, not the tip form. -->
<svelte:boundary>
	<ResourceDirectory />
	{#snippet failed()}{/snippet}
</svelte:boundary>

<!-- Submission form -->
<section class="section-tint-secondary px-6 py-16">
	<div class="mx-auto max-w-xl">
		<div class="mb-8 text-center">
			<h2 class="mb-2 text-3xl font-bold tracking-tight">
				{m.public_local_resources_suggest_resource()}
			</h2>
			<p class="text-base leading-relaxed text-fg-2">
				{m.public_local_resources_know_resource_corvallis_music_communi()}
			</p>
		</div>

		<TipForm />
	</div>
</section>
