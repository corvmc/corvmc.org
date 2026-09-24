<script lang="ts">
	import Hero from '$lib/components/public/Hero.svelte';
	import ResourceDirectory from './ResourceDirectory.svelte';
	import TipForm from './TipForm.svelte';
</script>

<svelte:head>
	<title>Local Resources | Corvallis Music Collective</title>
	<meta
		name="description"
		content="A community-built list of local music resources around Corvallis — shops, venues, record stores, artists, and more. Suggest one you think belongs."
	/>
</svelte:head>

<!-- Hero -->
<Hero title="Local Resources">
	Music shops, venues, record stores, studios and repair techs around Corvallis — the places we
	point people to. Know one we've missed? Tell us below.
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
			<h2 class="mb-2 text-3xl font-bold tracking-tight">Suggest a Resource</h2>
			<p class="text-base leading-relaxed text-fg-2">
				Know a resource the Corvallis music community should have on their radar? Send it our way.
				Staff check each one before it goes on the list.
			</p>
		</div>

		<TipForm />
	</div>
</section>
